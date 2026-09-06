//! "Already owned inside another release" — the guard that stops the downloader re-acquiring music
//! the library already holds.
//!
//! MusicBrainz models a bonus disc as its own release group: `In Rainbows Disk 2` is a separate group
//! from `In Rainbows`. A local folder that physically holds both discs binds to the *album* group, so
//! the bonus disc's group has no bind, looks uncovered, becomes a MISSING catalogue gap, and the
//! trickle worker downloads 8 tracks that were already on disc 2 of that folder.
//!
//! Coverage cannot see this because it is computed from release binds, and one `LocalRelease` can
//! only point at one MB release. So before writing a gap, we ask the stricter question the user
//! actually cares about: **are all of this release's tracks already sitting in one local release?**
//! If yes, the recordings are owned — we link the local tracks to this release's MB tracks (so the
//! knowledge is in the metadata, not in a title heuristic), record it as owned, and never queue it.
//!
//! Deliberately NOT done here: writing release-level MB ids onto those files. The folder holds 18
//! tracks and this release is 8 of them; making the 8 the majority `MUSICBRAINZ_ALBUMID` would rebind
//! the whole folder to the bonus disc on the next sync — the same bug mirrored, with `In Rainbows`
//! itself then looking missing. Track ids are per-track and carry no such risk; `sync
//! --only-write-mb-to-files` pushes them into the files.

use reqwest::Client;
use sqlx::PgPool;
use std::collections::HashMap;

use crate::db::{
    batch_insert_mb_tracks, batch_link_release_genres, ensure_mb_release_artist_link,
    ensure_release_type_cached, link_local_tracks_to_mb, mb_medium_rows,
    reject_queued_downloads_for_group, sync_mb_media_for_release, upsert_mb_release_with_media,
    MbReleaseExtras, MbTrackRow,
};
use crate::mb_api::{self, RateLimiter};
use crate::mb_types::{MbRelease, MbTrack};

/// Title comparison key: case-folded, punctuation- and whitespace-insensitive. Tag titles and MB
/// titles disagree on case and punctuation constantly ("Mk 1" vs "MK 1", "Bangers + Mash").
pub fn normalize_title(title: &str) -> String {
    title
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// One local release's tracks, as candidate container for an MB release.
#[derive(Debug, Clone)]
pub struct LocalBundle {
    pub release_id: String,
    pub title: String,
    /// (LocalReleaseTrack.id, track title, duration in seconds)
    pub tracks: Vec<(String, String, Option<i32>)>,
}

/// How far apart two recordings of the same title may be and still be the same recording, in seconds.
///
/// Titles alone are not enough: `In Rainbows: From the Basement` is the *same ten songs* as the album,
/// played live, so a title-only rule claimed it as "already owned" and would have hidden a release the
/// library genuinely lacks. Its takes run 1-33s off the studio ones; masterings and remasters of the
/// same recording differ by well under this. Since a claim needs EVERY track to match, one honest
/// outlier is enough to refuse.
const DURATION_TOLERANCE_SECS: i32 = 5;

/// Unknown duration on either side cannot refute a title match — it is missing evidence, not counter-
/// evidence. (Local durations come from the file; MB's `length` is frequently absent on older data.)
pub(crate) fn durations_compatible(local_secs: Option<i32>, mb_secs: Option<i32>) -> bool {
    match (local_secs, mb_secs) {
        (Some(a), Some(b)) => (a - b).abs() <= DURATION_TOLERANCE_SECS,
        _ => true,
    }
}

/// Smallest MB release worth claiming. A one- or two-track "release" would match by coincidence
/// inside any album; the bonus-disc case this exists for is always substantially longer.
const MIN_CLAIMABLE_TRACKS: usize = 3;

/// Which local release already contains **every** track of `mb_titles`, and which of its tracks they
/// are (parallel to `mb_titles`, so the caller can link track-for-track).
///
/// Strict by design, matching the rule agreed with the user: every MB track must be present, each
/// consuming a distinct local track. Partial overlap is not ownership — a deluxe edition sharing 9 of
/// 12 tracks with the standard one is a genuinely different release we may well want.
///
/// The bundle must be a **strict superset** (more tracks than the MB release). An exact-size match is
/// the ordinary "this folder *is* that release" case, which belongs to the matcher — claiming it here
/// would hide a release the normal bind should own.
pub fn find_owning_bundle<'a>(
    mb_tracks: &[(String, Option<i32>)],
    bundles: &'a [LocalBundle],
) -> Option<(&'a LocalBundle, Vec<String>)> {
    if mb_tracks.len() < MIN_CLAIMABLE_TRACKS {
        return None;
    }
    let wanted: Vec<(String, Option<i32>)> = mb_tracks
        .iter()
        .map(|(title, secs)| (normalize_title(title), *secs))
        .collect();

    for bundle in bundles {
        if bundle.tracks.len() <= mb_tracks.len() {
            continue;
        }
        let mut available: Vec<(usize, String, Option<i32>)> = bundle
            .tracks
            .iter()
            .enumerate()
            .map(|(i, (_, title, secs))| (i, normalize_title(title), *secs))
            .collect();

        let mut matched: Vec<String> = Vec::with_capacity(wanted.len());
        let mut complete = true;
        for (want_title, want_secs) in &wanted {
            let hit = available.iter().position(|(_, have_title, have_secs)| {
                have_title == want_title && durations_compatible(*have_secs, *want_secs)
            });
            match hit {
                Some(pos) => {
                    let (idx, _, _) = available.remove(pos);
                    matched.push(bundle.tracks[idx].0.clone());
                }
                None => {
                    complete = false;
                    break;
                }
            }
        }
        if complete {
            return Some((bundle, matched));
        }
    }
    None
}

/// Try to record `rg_id` as already owned inside one of `bundles`, instead of writing it as a gap.
///
/// Costs one MusicBrainz call (the group's official editions) and only runs for groups that are
/// otherwise about to become MISSING. On a claim it writes the real release + its tracks, links the
/// local tracks to them, marks the release COMPLETE with a reason naming the folder that holds it,
/// and pulls any dead queue row for the group. Returns the owning release's title.
#[allow(clippy::too_many_arguments)]
pub async fn claim_owned_bundle(
    pool: &PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    artist_id: &str,
    rg_id: &str,
    primary_type: Option<&str>,
    bundles: &[LocalBundle],
    release_type_cache: &mut HashMap<String, String>,
    artist_genre_ids: &[String],
) -> Option<String> {
    if bundles.is_empty() {
        return None;
    }
    let editions = mb_api::mb_get_release_tracks(http_client, rg_id, limiter)
        .await
        .ok()?;

    // Widest edition first: a claim on the fullest tracklist is the strongest statement of ownership.
    let mut ordered: Vec<&(MbRelease, Vec<MbTrack>)> = editions.iter().collect();
    ordered.sort_by_key(|(_, tracks)| std::cmp::Reverse(tracks.len()));

    for (release, tracks) in ordered {
        let mb_tracks: Vec<(String, Option<i32>)> = tracks
            .iter()
            .map(|t| (t.title.clone(), t.length.map(|ms| (ms / 1000) as i32)))
            .collect();
        let Some((bundle, local_track_ids)) = find_owning_bundle(&mb_tracks, bundles) else {
            continue;
        };

        let type_name = primary_type.unwrap_or("Other");
        let type_id = ensure_release_type_cached(pool, type_name, release_type_cache)
            .await
            .ok()?;
        let year = release
            .date
            .as_deref()
            .and_then(|d| d.split('-').next())
            .and_then(|y| y.parse::<i32>().ok());
        let reason = format!("Owned as part of \"{}\"", bundle.title);
        let extras = MbReleaseExtras {
            release_date: release.date.as_deref(),
            packaging: release.packaging.as_deref(),
            country: release.country.as_deref(),
            ..Default::default()
        };
        let medium_rows = mb_medium_rows(&release.media);
        let mb_db_id = upsert_mb_release_with_media(
            pool,
            &release.id,
            rg_id,
            &release.title,
            year,
            &type_id,
            "COMPLETE",
            Some(&reason),
            release.disambiguation.as_deref(),
            &extras,
            medium_rows.len().max(1) as i32,
        )
        .await
        .ok()?;
        sync_mb_media_for_release(pool, &mb_db_id, &medium_rows)
            .await
            .ok();

        let track_rows: Vec<MbTrackRow> = tracks
            .iter()
            .map(|t| MbTrackRow {
                title: t.title.clone(),
                position: t.position.map(|p| p as i32),
                disc_number: t.disc_number.map(|d| d as i32),
                duration_ms: t.length.map(|l| l as i32),
                mb_id: Some(t.id.clone()),
                recording_id: t.recording.as_ref().map(|r| r.id.clone()),
            })
            .collect();
        let inserted = batch_insert_mb_tracks(pool, &mb_db_id, &track_rows)
            .await
            .unwrap_or_default();

        // batch_insert_mb_tracks preserves input order, so index i is the i-th MB track — the same
        // index `find_owning_bundle` reported the local track for.
        let links: Vec<(String, String)> = local_track_ids
            .iter()
            .zip(inserted.iter())
            .map(|(local_id, (mb_track_db_id, _))| (local_id.clone(), mb_track_db_id.clone()))
            .collect();
        link_local_tracks_to_mb(pool, &links).await.ok();

        ensure_mb_release_artist_link(pool, &mb_db_id, artist_id).await.ok();
        batch_link_release_genres(pool, &mb_db_id, artist_genre_ids).await.ok();
        reject_queued_downloads_for_group(pool, rg_id, &reason).await.ok();

        return Some(bundle.title.clone());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Local bundle with unknown durations - the title-only case.
    fn bundle(id: &str, titles: &[&str]) -> LocalBundle {
        LocalBundle {
            release_id: id.to_string(),
            title: format!("bundle {}", id),
            tracks: titles
                .iter()
                .enumerate()
                .map(|(i, t)| (format!("{}-t{}", id, i), t.to_string(), None))
                .collect(),
        }
    }

    fn timed_bundle(id: &str, tracks: &[(&str, i32)]) -> LocalBundle {
        LocalBundle {
            release_id: id.to_string(),
            title: format!("bundle {}", id),
            tracks: tracks
                .iter()
                .enumerate()
                .map(|(i, (t, secs))| (format!("{}-t{}", id, i), t.to_string(), Some(*secs)))
                .collect(),
        }
    }

    fn titles(v: &[&str]) -> Vec<(String, Option<i32>)> {
        v.iter().map(|s| (s.to_string(), None)).collect()
    }

    fn timed(v: &[(&str, i32)]) -> Vec<(String, Option<i32>)> {
        v.iter().map(|(s, secs)| (s.to_string(), Some(*secs))).collect()
    }

    // The real case: a folder holding CD 01 + CD 02 of In Rainbows, versus MusicBrainz's separate
    // "In Rainbows Disk 2" release group.
    #[test]
    fn claims_a_bonus_disc_sitting_inside_a_two_disc_folder() {
        let local = bundle(
            "in-rainbows",
            &[
                "15 Step", "Bodysnatchers", "Nude", "Weird Fishes", "All I Need", "Faust Arp",
                "Reckoner", "House of Cards", "Jigsaw Falling Into Place", "Videotape",
                "Mk 1", "Down Is the New Up", "Go Slowly", "Mk 2", "Last Flowers",
                "Up on the Ladder", "Bangers + Mash", "4 Minute Warning",
            ],
        );
        let disk2 = titles(&[
            "MK 1", "Down Is the New Up", "Go Slowly", "MK 2", "Last Flowers", "Up on the Ladder",
            "Bangers + Mash", "4 Minute Warning",
        ]);
        let bundles = [local];
        let (owner, matched) = find_owning_bundle(&disk2, &bundles).expect("bundle owns disk 2");
        assert_eq!(owner.release_id, "in-rainbows");
        assert_eq!(matched.len(), 8);
        assert_eq!(matched[0], "in-rainbows-t10"); // "Mk 1", not disc 1's opener
    }

    // The false positive that titles alone let through: "In Rainbows: From the Basement" is the same
    // ten songs as the album, performed live. Real durations from MusicBrainz and the local files.
    #[test]
    fn a_live_rerecording_of_the_same_songs_is_not_owned() {
        let album = timed_bundle(
            "in-rainbows",
            &[
                ("15 Step", 237), ("Bodysnatchers", 242), ("Nude", 255),
                ("Weird Fishes/Arpeggi", 318), ("All I Need", 228), ("Faust Arp", 129),
                ("Reckoner", 290), ("House of Cards", 328), ("Jigsaw Falling Into Place", 248),
                ("Videotape", 279), ("Mk 1", 66), ("Down Is the New Up", 300),
            ],
        );
        let from_the_basement = timed(&[
            ("15 Step", 236), ("Bodysnatchers", 256), ("House of Cards", 329),
            ("Bangers + Mash", 211), ("Videotape", 287), ("Reckoner", 303),
            ("Go Slowly", 234), ("All I Need", 261), ("Nude", 261),
            ("Weird Fishes/Arpeggi", 320),
        ]);
        assert!(find_owning_bundle(&from_the_basement, &[album]).is_none());
    }

    #[test]
    fn the_same_recording_still_matches_across_a_small_encoding_drift() {
        let local = timed_bundle(
            "two-disc",
            &[
                ("A", 200), ("B", 200), ("C", 200), ("D", 200),
                ("Mk 1", 66), ("Down Is the New Up", 300), ("Go Slowly", 234),
            ],
        );
        let disc_two = timed(&[("Mk 1", 67), ("Down Is the New Up", 299), ("Go Slowly", 234)]);
        assert!(find_owning_bundle(&disc_two, &[local]).is_some());
    }

    #[test]
    fn one_missing_track_is_not_ownership() {
        let local = bundle("album", &["A", "B", "C", "D", "E"]);
        assert!(find_owning_bundle(&titles(&["A", "B", "X"]), &[local]).is_none());
    }

    // An exact-size match is the matcher's job (bind the folder), not a claim.
    #[test]
    fn an_exact_size_match_is_left_to_the_matcher() {
        let local = bundle("ep", &["A", "B", "C"]);
        assert!(find_owning_bundle(&titles(&["A", "B", "C"]), &[local]).is_none());
    }

    #[test]
    fn tiny_releases_are_never_claimed() {
        let local = bundle("album", &["A", "B", "C", "D", "E"]);
        assert!(find_owning_bundle(&titles(&["A", "B"]), &[local]).is_none());
    }

    // Two copies of the same track in the bundle must not satisfy two different MB tracks.
    #[test]
    fn each_mb_track_consumes_a_distinct_local_track() {
        let local = bundle("album", &["A", "A", "B", "C", "D"]);
        let (_, matched) = find_owning_bundle(&titles(&["A", "A", "B"]), &[local.clone()]).unwrap();
        assert_eq!(matched, vec!["album-t0", "album-t1", "album-t2"]);
        assert!(find_owning_bundle(&titles(&["A", "A", "A"]), &[local]).is_none());
    }

    #[test]
    fn punctuation_and_case_do_not_block_a_match() {
        assert_eq!(normalize_title("Bangers + Mash"), "bangersmash");
        assert_eq!(normalize_title("MK 1"), normalize_title("Mk 1"));
    }
}
