use super::*;
use std::collections::HashSet;

use crate::mb_api::{self, RateLimiter};
use common::mb::types::{MbMedia, MbRelease};
use common::progress::Reporter;
use reqwest::Client;
use sqlx::PgPool;

// Candidate discovery - network + DB
// ---------------------------------------------------------------------------

/// Where a candidate box release came from, and therefore what still has to happen to it before a
/// sibling can be bound to it.
pub(crate) enum CandidateSource {
    /// Fetched from MusicBrainz. Its `MusicBrainzRelease` + media + track rows must be persisted
    /// (`persist_box_media`) before anything can point at it.
    Fetched {
        release: Box<MbRelease>,
        rg_id: String,
        primary_type: Option<String>,
    },
    /// Rebuilt from rows this box already has in the database, with no MusicBrainz call at all - the
    /// whole point of `candidates_from_db`. Nothing to persist; the row id is already known.
    Stored { mb_db_id: String },
}

pub(crate) struct FetchedCandidate {
    pub(crate) candidate: BoxCandidate,
    /// The release's own title, for log lines - the one field both sources always have.
    pub(crate) title: String,
    pub(crate) source: CandidateSource,
}

/// Candidates plus how many MusicBrainz lookups failed while gathering them. A failed lookup is **not**
/// the same as "no box exists", and conflating the two is what let a transient outage look like a
/// settled negative for a whole rollout - see `BoxSetSummary::candidate_fetch_errors`.
#[derive(Default)]
pub(crate) struct CandidateFetch {
    pub(crate) candidates: Vec<FetchedCandidate>,
    pub(crate) errors: usize,
}

fn build_candidate(release_id: &str, media: &Option<Vec<MbMedia>>) -> Option<BoxCandidate> {
    let discs = common::mb::api::audio_media(media);
    if discs.len() < 2 {
        return None;
    }
    let media_rows: Vec<BoxMedium> = discs
        .into_iter()
        .filter_map(|m| {
            Some(BoxMedium {
                position: m.position? as i32,
                tracks: m
                    .tracks
                    .as_ref()?
                    .iter()
                    .map(|t| {
                        (
                            t.id.clone(),
                            t.title.clone(),
                            t.length.map(|l| (l / 1000) as i32),
                        )
                    })
                    .collect(),
            })
        })
        .collect();
    if media_rows.len() < 2 {
        return None;
    }
    Some(BoxCandidate {
        release_id: release_id.to_string(),
        media: media_rows,
    })
}

/// A MusicBrainz lookup that failed: logged, not swallowed. `reporter.sub_step` alone put this in a
/// run log nobody keeps, so a 503 during a six-hour pass was indistinguishable in the summary from a
/// group that genuinely has no box release (docs/specs/spec_tidy_observations.md).
fn note_fetch_error(reporter: &Reporter, what: &str, err: &str) {
    let msg = format!("box candidate lookup failed ({what}): {err}");
    reporter.sub_step(&format!("  -> {msg}"));
    common::error_log::log_warn(&msg);
}

/// Tier (a): the siblings' own majority embedded MB release ids, looked up directly. Catches a box
/// where at least one disc's tag happens to point at the box release itself.
pub(crate) async fn candidates_from_embedded_ids(
    http_client: &Client,
    limiter: &mut RateLimiter,
    ids: &[String],
    reporter: &Reporter,
) -> CandidateFetch {
    let mut out = CandidateFetch::default();
    for id in ids {
        reporter.sub_step(&format!("tier (a): looking up embedded id {id}..."));
        match mb_api::mb_get_release_by_id(http_client, id, limiter).await {
            Ok(by_id) => match build_candidate(&by_id.release.id, &by_id.release.media) {
                Some(candidate) => {
                    reporter.sub_step(&format!(
                        "  -> \"{}\", {} disc(s)",
                        by_id.release.title,
                        candidate.media.len()
                    ));
                    out.candidates.push(FetchedCandidate {
                        candidate,
                        title: by_id.release.title.clone(),
                        source: CandidateSource::Fetched {
                            release: Box::new(by_id.release),
                            rg_id: by_id.rg_id,
                            primary_type: by_id.primary_type,
                        },
                    });
                }
                None => reporter.sub_step(&format!(
                    "  -> \"{}\" has only 1 medium, not a box",
                    by_id.release.title
                )),
            },
            Err(e) => {
                note_fetch_error(reporter, &format!("release {id}"), &e);
                out.errors += 1;
            }
        }
    }
    out
}

/// Tier (b): search MusicBrainz for the parent folder's own title. Catches a box where no sibling's
/// tag points anywhere near it (every disc is tagged as its own standalone album).
pub(crate) async fn candidates_from_search(
    http_client: &Client,
    limiter: &mut RateLimiter,
    title: &str,
    artist_name: &str,
    reporter: &Reporter,
) -> CandidateFetch {
    let mut out = CandidateFetch::default();
    reporter.sub_step(&format!(
        "tier (b): searching MusicBrainz for \"{title}\" by {artist_name}..."
    ));
    let hits =
        match mb_api::mb_search_release_groups(http_client, title, artist_name, limiter).await {
            Ok(hits) => hits,
            Err(e) => {
                note_fetch_error(reporter, &format!("search \"{title}\""), &e);
                out.errors += 1;
                return out;
            }
        };
    reporter.sub_step(&format!("  -> {} release group(s) found", hits.len()));
    for rg in hits {
        if !common::mb::allowlist::is_allowed(rg.primary_type.as_deref(), &rg.secondary_types, None)
        {
            reporter.sub_step(&format!(
                "  -> \"{}\" rejected by the allow-list ({:?}, {:?})",
                rg.title, rg.primary_type, rg.secondary_types
            ));
            continue;
        }
        let fetched = candidates_from_release_group(
            http_client,
            limiter,
            &rg.id,
            rg.primary_type.as_deref(),
            &HashSet::new(),
            reporter,
        )
        .await;
        out.errors += fetched.errors;
        out.candidates.extend(fetched.candidates);
    }
    out
}

/// Every multi-medium edition of one release group, as bind candidates.
///
/// Shared by tier (b)'s search and tier (c) below, which is the point: MusicBrainz catalogues several
/// editions of the same box (region and label variants), the ordinary album matcher binds whichever one
/// it happened to pick, and that edition's tracklist may simply not be the one on disc. Trying the
/// group's *other* editions costs one paginated call and uses the existing perfect-match rule
/// unchanged - more candidates, not a looser test (docs/sync_decisions.md §19 item 1a).
///
/// `exclude` skips release ids already tried, so tier (c) never re-checks the candidate that just
/// failed.
pub(crate) async fn candidates_from_release_group(
    http_client: &Client,
    limiter: &mut RateLimiter,
    rg_id: &str,
    primary_type: Option<&str>,
    exclude: &HashSet<String>,
    reporter: &Reporter,
) -> CandidateFetch {
    let mut out = CandidateFetch::default();
    let editions = match mb_api::mb_get_release_tracks(http_client, rg_id, limiter).await {
        Ok(editions) => editions,
        Err(e) => {
            note_fetch_error(reporter, &format!("release group {rg_id}"), &e);
            out.errors += 1;
            return out;
        }
    };
    reporter.sub_step(&format!("  -> {} edition(s) to check", editions.len()));
    for (release, _flattened) in editions {
        if exclude.contains(&release.id) {
            continue;
        }
        match build_candidate(&release.id, &release.media) {
            Some(candidate) => {
                reporter.sub_step(&format!(
                    "     \"{}\" ({}), {} disc(s)",
                    release.title,
                    release.id,
                    candidate.media.len()
                ));
                out.candidates.push(FetchedCandidate {
                    candidate,
                    title: release.title.clone(),
                    source: CandidateSource::Fetched {
                        release: Box::new(release),
                        rg_id: rg_id.to_string(),
                        primary_type: primary_type.map(str::to_string),
                    },
                });
            }
            None => reporter.sub_step(&format!(
                "     \"{}\" has only 1 medium, not a box",
                release.title
            )),
        }
    }
    out
}

/// Tier (d): rebuild a candidate from rows the box already has in the database, with **no** MusicBrainz
/// call.
///
/// Only used for a group whose siblings are already placed. Those groups are re-discovered on every
/// unscoped run by design - a disc must still be able to move when a new equivalence appears - but
/// re-fetching the box to learn what the database already knows cost a cold lookup (~10s) each time,
/// for 230 groups, for no new information (docs/sync_decisions.md §19 item 3).
///
/// Strictly an optimisation, never a different answer: anything incomplete about the stored rows
/// (fewer than two media, a medium with no tracks, a medium whose `trackCount` disagrees with the rows
/// present, a track with no MusicBrainz id) returns `None` and the caller falls back to the network.
pub(crate) async fn candidates_from_db(pool: &PgPool, mb_ids: &[String]) -> Vec<FetchedCandidate> {
    let mut out = Vec::new();
    for mb_id in mb_ids {
        let Ok(Some((db_id, title))) = sqlx::query_as::<_, (String, String)>(
            r#"SELECT id, title FROM "MusicBrainzRelease"
               WHERE "musicbrainzId" = $1 AND "mediumCount" > 1"#,
        )
        .bind(mb_id)
        .fetch_optional(pool)
        .await
        else {
            continue;
        };

        let Ok(medium_rows) = sqlx::query_as::<_, (i32, i32)>(
            r#"SELECT position, "trackCount" FROM "MusicBrainzReleaseMedium"
               WHERE "releaseId" = $1 ORDER BY position"#,
        )
        .bind(&db_id)
        .fetch_all(pool)
        .await
        else {
            continue;
        };
        if medium_rows.len() < 2 {
            continue;
        }

        let Ok(track_rows) = sqlx::query_as::<_, StoredTrackRow>(
            r#"SELECT "discNumber", "musicbrainzId", title, "durationMs"
               FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1
               ORDER BY "discNumber" NULLS FIRST, position"#,
        )
        .bind(&db_id)
        .fetch_all(pool)
        .await
        else {
            continue;
        };

        let Some(candidate) = box_candidate_from_rows(mb_id, &medium_rows, &track_rows) else {
            continue;
        };
        out.push(FetchedCandidate {
            candidate,
            title,
            source: CandidateSource::Stored { mb_db_id: db_id },
        });
    }
    out
}

/// The pure half of `candidates_from_db`: stored medium + track rows in, a `BoxCandidate` out, or
/// `None` when the stored rows are not a faithful copy of the box.
///
/// Every rejection here sends the caller back to the network, so these are the rules that keep tier (d)
/// an optimisation rather than a second, weaker source of truth:
/// fewer than two media, a medium with no tracks, a medium whose row count disagrees with its recorded
/// `trackCount` (a half-synced release), or a track with no MusicBrainz id (nothing to link against).
/// (discNumber, musicbrainzId, title, durationMs) - a stored `MusicBrainzReleaseTrack` row, as
/// `candidates_from_db`'s tier (d) rebuilds a candidate straight from already-synced rows.
type StoredTrackRow = (Option<i32>, Option<String>, String, Option<i32>);

pub(crate) fn box_candidate_from_rows(
    release_mb_id: &str,
    medium_rows: &[(i32, i32)],
    track_rows: &[StoredTrackRow],
) -> Option<BoxCandidate> {
    if medium_rows.len() < 2 {
        return None;
    }
    let mut media: Vec<BoxMedium> = Vec::with_capacity(medium_rows.len());
    for (position, track_count) in medium_rows {
        let tracks: Vec<(String, String, Option<i32>)> = track_rows
            .iter()
            .filter(|(disc, _, _, _)| *disc == Some(*position))
            .filter_map(|(_, mb_track_id, title, duration_ms)| {
                Some((
                    mb_track_id.clone()?,
                    title.clone(),
                    duration_ms.map(|ms| ms / 1000),
                ))
            })
            .collect();
        if tracks.is_empty() || tracks.len() as i32 != *track_count {
            return None;
        }
        media.push(BoxMedium {
            position: *position,
            tracks,
        });
    }
    (media.len() >= 2).then(|| BoxCandidate {
        release_id: release_mb_id.to_string(),
        media,
    })
}

/// Best-effort box title from a parent folder name: strip a leading "YYYY - " and any trailing
/// "(...)" or "[...]" annotation ("(9CD)", "(Deluxe Edition, 2014, 3 CD)", "[#74321 96173 2]" - a
/// catalogue number in brackets, which MusicBrainz's own title never carries and which would
/// otherwise return zero search hits if left in). Whichever bracket opens first is where the title
/// ends - a folder can carry either or both, in either order. MB search tolerates the rest, and the
/// real gate is the track-level perfect match in `plan_box_bind`, not this string.
pub(crate) fn guess_box_title(parent_folder: &str) -> String {
    let last = parent_folder.rsplit('/').next().unwrap_or(parent_folder);
    let without_year = if last.len() > 4 && last.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        last[4..].trim_start_matches([' ', '-']).trim_start()
    } else {
        last
    };
    let cut = [without_year.find('('), without_year.find('[')]
        .into_iter()
        .flatten()
        .min();
    match cut {
        Some(idx) => without_year[..idx].trim().to_string(),
        None => without_year.trim().to_string(),
    }
}

// ---------------------------------------------------------------------------
