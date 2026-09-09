use crate::mb_types::{MbRelease, MbTrack};
use common::types::TrackMeta;
use unicode_normalization::UnicodeNormalization;

// ---------------------------------------------------------------------------
// Title normalisation
// ---------------------------------------------------------------------------

pub fn normalize_title(title: &str) -> String {
    title
        .to_lowercase()
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Words that shouldn't count toward a title match - the same list `common::mb::names::names_are_similar`
/// filters for the identical reason when comparing artist names. Without this, two different songs
/// that happen to share "the"/"and"/"of" score higher than the words that actually distinguish them.
const NOISE_WORDS: &[&str] = &[
    "the", "and", "&", "a", "an", "of", "in", "on", "at", "to", "for", "with", "by", "from", "or",
    "is", "et", "und", "e", "y", "i",
];

fn titles_match(a: &str, b: &str) -> bool {
    let na = normalize_title(a);
    let nb = normalize_title(b);
    if na == nb {
        return true;
    }
    // Substring containment handles remaster/live/bonus variants
    if na.contains(nb.as_str()) || nb.contains(na.as_str()) {
        return true;
    }
    // Jaccard on word sets as fallback, noise words excluded so they can't inflate a match between
    // two titles that don't actually share any meaningful word.
    let noise: std::collections::HashSet<&str> = NOISE_WORDS.iter().copied().collect();
    let words_a: std::collections::HashSet<&str> =
        na.split_whitespace().filter(|w| !noise.contains(w)).collect();
    let words_b: std::collections::HashSet<&str> =
        nb.split_whitespace().filter(|w| !noise.contains(w)).collect();
    if words_a.is_empty() || words_b.is_empty() {
        return false;
    }
    let inter = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    inter as f64 / union as f64 >= 0.8
}

// ---------------------------------------------------------------------------
// Release status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum ReleaseStatus {
    Complete,
    Incomplete,
    ExtraTracks,
    MissingTracks,
}

pub struct StatusCheck {
    pub status: ReleaseStatus,
    pub matched_mb_tracks: Vec<(MbTrack, Option<String>)>, // (mb_track, local_track_id)
    pub best_release_idx: usize,
    pub best_release_id: String,
    pub best_release_disambiguation: Option<String>,
    // Strict-match flag: true when binding to a specific MB release is unambiguous.
    // - Tier 1 (single release returned): always true.
    // - Tier 2 (release group with multiple siblings): true only when exactly one sibling
    //   has a track count equal to the local folder's track count.
    // When false, callers must NOT bind LocalRelease.releaseId - leave Unmatched.
    pub is_confident: bool,
}

fn year_from_date(d: Option<&str>) -> Option<i32> {
    d.and_then(|s| s.split('-').next())
        .and_then(|y| y.parse::<i32>().ok())
}

fn release_has_cd_format(release: &MbRelease) -> bool {
    release.media.as_ref().is_some_and(|ms| {
        ms.iter().any(|m| {
            m.format
                .as_deref()
                .map(|f| f.eq_ignore_ascii_case("CD"))
                .unwrap_or(false)
        })
    })
}

/// Restrict a release's flattened tracklist to one medium's tracks (`discNumber = position`), when
/// `medium_position` is set. A folder bound to one disc of a multi-medium release must be scored
/// against that disc alone - scoring it against the release's full, every-disc tracklist reads a
/// complete single disc as `MISSING_TRACKS` (docs/sync_decisions.md). `None` (a single-medium
/// release, or the whole-release case a fold uses) leaves the tracklist untouched.
fn scope_to_medium(tracks: &[MbTrack], medium_position: Option<i32>) -> Vec<MbTrack> {
    match medium_position {
        Some(pos) => tracks
            .iter()
            .filter(|t| t.disc_number == Some(pos as u32))
            .cloned()
            .collect(),
        None => tracks.to_vec(),
    }
}

pub fn check_release_status(
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    mb_releases: &[(MbRelease, Vec<MbTrack>)],
    local_year: Option<i32>,
    medium_position: Option<i32>,
) -> StatusCheck {
    if mb_releases.is_empty() {
        return StatusCheck {
            status: ReleaseStatus::Incomplete,
            matched_mb_tracks: Vec::new(),
            best_release_idx: 0,
            best_release_id: String::new(),
            best_release_disambiguation: None,
            is_confident: false,
        };
    }

    let local_count = local_tracks.len();

    let scoped: Vec<Vec<MbTrack>> = mb_releases
        .iter()
        .map(|(_, tracks)| scope_to_medium(tracks, medium_position))
        .collect();

    let exact_matches: Vec<usize> = scoped
        .iter()
        .enumerate()
        .filter(|(_, tracks)| tracks.len() == local_count)
        .map(|(i, _)| i)
        .collect();

    let (best_idx, is_confident) = if mb_releases.len() == 1 {
        (0, true)
    } else if exact_matches.len() == 1 {
        (exact_matches[0], true)
    } else if !exact_matches.is_empty() {
        // Tiebreak among same-track-count siblings:
        //   1. Prefer same year as local folder.
        //   2. Prefer CD format.
        //   3. Earliest date wins.
        let by_year: Vec<usize> = local_year
            .map(|ly| {
                exact_matches
                    .iter()
                    .copied()
                    .filter(|&i| year_from_date(mb_releases[i].0.date.as_deref()) == Some(ly))
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| exact_matches.clone());

        let by_cd: Vec<usize> = by_year
            .iter()
            .copied()
            .filter(|&i| release_has_cd_format(&mb_releases[i].0))
            .collect();
        let pool = if !by_cd.is_empty() { by_cd } else { by_year };

        let chosen = *pool
            .iter()
            .min_by_key(|&&i| {
                mb_releases[i]
                    .0
                    .date
                    .clone()
                    .unwrap_or_else(|| "9999-99-99".into())
            })
            .unwrap();
        (chosen, true)
    } else {
        (0, false)
    };

    let best_release = &mb_releases[best_idx];

    let mb_tracks = &scoped[best_idx];
    let mb_count = mb_tracks.len();

    // Match local tracks → MB tracks by title, exact matches claimed before loose ones are even
    // tried.
    //
    // `titles_match` folds exact/substring/Jaccard into one test, and a single greedy pass over it
    // lets an early loose match steal a track a later *exact* match needed - live case: a bonus disc
    // full of alternate takes ("I'll Be Home on Christmas Day", "(remake)", "(take 3)", "(take 4)").
    // MB's plain title reached the loop first and substring-matched into the local "(take 3)" file
    // before the exact pairing (MB plain -> local plain) got a turn; MB's own "(remake)" was then
    // forced to steal the now-only-remaining local plain file, and MB's real "(take 3)" had nothing
    // left to pair with - a false MISSING_TRACKS on an otherwise perfect disc.
    // Same fix already applied to box-disc pairing (`boxset::pair_tracks`): claim every identical title
    // first, only let a loose match compete for what's left.
    let mut matched: Vec<(MbTrack, Option<String>)> = Vec::new();
    let mut used_local: std::collections::HashSet<usize> = Default::default();
    let mut loose_pending: Vec<usize> = Vec::new(); // indices into mb_tracks left for pass 2

    for (mi, mb_track) in mb_tracks.iter().enumerate() {
        let exact = normalize_title(&mb_track.title);
        let hit = local_tracks.iter().enumerate().find(|(i, local)| {
            !used_local.contains(i) && normalize_title(local.title.as_deref().unwrap_or("")) == exact
        });
        match hit {
            Some((idx, _)) => {
                used_local.insert(idx);
                matched.push((mb_track.clone(), Some(local_track_ids[idx].clone())));
            }
            None => {
                loose_pending.push(mi);
                matched.push((mb_track.clone(), None)); // placeholder, resolved (or not) below
            }
        }
    }

    for mi in loose_pending {
        let mb_track = &mb_tracks[mi];
        let mut matched_idx: Option<usize> = None;
        for (i, local) in local_tracks.iter().enumerate() {
            if used_local.contains(&i) {
                continue;
            }
            let local_title = local.title.as_deref().unwrap_or("");
            if titles_match(&mb_track.title, local_title) {
                matched_idx = Some(i);
                break;
            }
        }
        if let Some(idx) = matched_idx {
            used_local.insert(idx);
            matched[mi].1 = Some(local_track_ids[idx].clone());
        }
    }

    let unmatched_mb = matched.iter().filter(|(_, lid)| lid.is_none()).count();
    let unmatched_local = local_count - used_local.len();

    let status = if unmatched_mb == 0 && unmatched_local == 0 {
        ReleaseStatus::Complete
    } else if local_count > mb_count {
        ReleaseStatus::ExtraTracks
    } else if unmatched_mb > 0 {
        ReleaseStatus::MissingTracks
    } else {
        ReleaseStatus::Incomplete
    };

    StatusCheck {
        status,
        matched_mb_tracks: matched,
        best_release_idx: best_idx,
        best_release_id: best_release.0.id.clone(),
        best_release_disambiguation: best_release.0.disambiguation.clone(),
        is_confident,
    }
}

pub fn status_to_db_string(s: &ReleaseStatus) -> &'static str {
    match s {
        ReleaseStatus::Complete => "COMPLETE",
        ReleaseStatus::Incomplete => "INCOMPLETE",
        ReleaseStatus::ExtraTracks => "EXTRA_TRACKS",
        ReleaseStatus::MissingTracks => "MISSING_TRACKS",
    }
}

#[cfg(test)]
mod titles_match_tests {
    use super::titles_match;

    #[test]
    fn exact_match_after_normalizing_case_and_whitespace() {
        assert!(titles_match("Hello World", "hello   world"));
    }

    #[test]
    fn containment_handles_remaster_and_live_suffixes() {
        assert!(titles_match("Song Title", "Song Title (Live)"));
        assert!(titles_match("Song Title - 2011 Remaster", "Song Title"));
    }

    #[test]
    fn jaccard_fallback_still_matches_a_close_title_with_no_noise_words_involved() {
        // Nine unique words, one differs at the end - (8 shared)/(10 union) = 0.8, right at the
        // threshold. No noise words here, so this is unaffected by the fix: it isolates that the
        // 0.8 threshold itself is untouched.
        let a = "alpha bravo charlie delta echo foxtrot golf hotel apple";
        let b = "alpha bravo charlie delta echo foxtrot golf hotel banana";
        assert!(titles_match(a, b));
    }

    #[test]
    fn jaccard_fallback_rejects_titles_with_little_real_overlap() {
        assert!(!titles_match("Alpha Bravo Charlie", "Delta Echo Foxtrot"));
    }

    #[test]
    fn noise_words_no_longer_inflate_a_mismatch_into_a_match() {
        // Constructed to isolate the mechanism, not lifted from a real title pair: 8 of 9 words
        // shared pre-filter, but 3 of those 8 ("the", "and", "of") are noise. Pre-fix this scored
        // 8/10 = 0.8 and matched despite the only real content ("apple" vs "banana") differing
        // completely - the same class of false positive `names_are_similar` already guards against
        // for artist names. Post-fix, filtering those 3 words drops it to 5/7 ~= 0.71 - no match.
        let a = "the alpha and bravo of charlie delta echo apple";
        let b = "the alpha and bravo of charlie delta echo banana";
        assert!(
            !titles_match(a, b),
            "noise words inflated an otherwise-different pair into a false match"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mb_types::MbMedia;

    fn track(title: &str) -> TrackMeta {
        TrackMeta {
            file_path: String::new(),
            file_size: 0,
            mtime: chrono::Utc::now().naive_utc(),
            title: Some(title.to_string()),
            artist: None,
            album_artist: None,
            artists: Vec::new(),
            mb_artist_ids: Vec::new(),
            album_artists: Vec::new(),
            mb_album_artist_ids: Vec::new(),
            album: None,
            year: None,
            genre: None,
            track_number: None,
            disc_number: None,
            duration: None,
            bitrate: None,
            sample_rate: None,
            position: None,
            content_hash: String::new(),
            metadata_json: serde_json::Value::Null,
            has_picture: false,
            mb_release_id: None,
            mb_release_group_id: None,
            mb_album_artist_id: None,
        }
    }

    fn track_ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("local-track-{i}")).collect()
    }

    fn mb_track(id: &str, title: &str) -> MbTrack {
        MbTrack {
            id: id.to_string(),
            title: title.to_string(),
            position: None,
            length: None,
            disc_number: None,
            recording: None,
        }
    }

    fn mb_track_disc(id: &str, title: &str, disc_number: u32) -> MbTrack {
        MbTrack {
            disc_number: Some(disc_number),
            ..mb_track(id, title)
        }
    }

    /// The domino this exists to prevent: a bonus disc of alternate takes shares a base title across
    /// several tracks. A single greedy pass let MB's *plain* title steal a differently-ordered local
    /// "(take 3)" file via loose matching before the real exact pairing got a turn, leaving MB's real
    /// "(take 3)" homeless - a false MISSING_TRACKS on a disc that is actually complete.
    ///
    /// **The first version of this test did not actually exercise the bug.** It used matching index
    /// order on both sides (`locals[i]` paired with `mb_tracks[i]`), under which the exact check inside
    /// `titles_match` always won on the very first candidate - old and new code produced an identical
    /// result. A regression test that passes under the code it is meant to catch is worse than no test:
    /// it reads as coverage while providing none. This version uses the **real file order** from the
    /// live case (Elvis Presley's "Elvis Back in Nashville") - by `trackNumber`, "(take 3)" sits at
    /// position 12, the plain title at 20, "(remake)" at 25 - and the real MusicBrainz tracklist order,
    /// confirmed by differential replay to produce MISSING_TRACKS under the pre-fix single pass and
    /// COMPLETE under this one.
    #[test]
    fn exact_titles_are_claimed_before_a_loose_match_can_steal_one() {
        let locals = vec![
            track("I'll Be Home on Christmas Day (take 3)"), // trackNumber 12
            track("I'll Be Home on Christmas Day (take 4)"), // trackNumber 17
            track("I'll Be Home on Christmas Day"),          // trackNumber 20
            track("I'll Be Home on Christmas Day (remake)"), // trackNumber 25
        ];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(4);
        // MusicBrainz's own tracklist order for this disc - plain title first, "(take 3)" well after.
        let mb_tracks = vec![
            mb_track("m1", "I’ll Be Home on Christmas Day"),
            mb_track("m2", "I’ll Be Home on Christmas Day (remake)"),
            mb_track("m3", "I’ll Be Home on Christmas Day (take 3)"),
            mb_track("m4", "I’ll Be Home on Christmas Day (take 4)"),
        ];
        let release = mb_release("r1", None, None);
        let check = check_release_status(&local_refs, &ids, &[(release, mb_tracks)], None, None);
        assert_eq!(check.status, ReleaseStatus::Complete);

        // Not just the status - the *pairing* must be exact-to-exact, not a swapped loose match that
        // happens to leave the aggregate count looking fine.
        let by_mb_id: std::collections::HashMap<&str, Option<&str>> = check
            .matched_mb_tracks
            .iter()
            .map(|(t, lid)| (t.id.as_str(), lid.as_deref()))
            .collect();
        assert_eq!(by_mb_id["m1"], Some(ids[2].as_str()), "plain title must pair with the plain file");
        assert_eq!(by_mb_id["m2"], Some(ids[3].as_str()), "remake must pair with the remake file");
        assert_eq!(by_mb_id["m3"], Some(ids[0].as_str()), "take 3 must pair with the take-3 file");
        assert_eq!(by_mb_id["m4"], Some(ids[1].as_str()), "take 4 must pair with the take-4 file");
    }

    /// Even when old code got the *status* right, it could still get the *pairing* wrong - swapping
    /// which local file a duplicate-ish MB track links to. That is a data-correctness issue on its own
    /// (wrong recording linked to wrong file) independent of whether it happens to change the reported
    /// completeness.
    #[test]
    fn exact_pairing_holds_even_when_a_loose_match_would_have_produced_the_same_status() {
        let locals = vec![
            track("Song A (Extended)"), // deliberately the *loose* candidate first
            track("Song A"),
        ];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let mb_tracks = vec![mb_track("m1", "Song A"), mb_track("m2", "Song A (Extended)")];
        let release = mb_release("r1", None, None);
        let check = check_release_status(&local_refs, &ids, &[(release, mb_tracks)], None, None);
        assert_eq!(check.status, ReleaseStatus::Complete);
        let by_mb_id: std::collections::HashMap<&str, Option<&str>> = check
            .matched_mb_tracks
            .iter()
            .map(|(t, lid)| (t.id.as_str(), lid.as_deref()))
            .collect();
        assert_eq!(by_mb_id["m1"], Some(ids[1].as_str()), "\"Song A\" must link to the plain file, not the Extended one it would loosely match first");
        assert_eq!(by_mb_id["m2"], Some(ids[0].as_str()));
    }

    fn mb_release(id: &str, date: Option<&str>, format: Option<&str>) -> MbRelease {
        MbRelease {
            id: id.to_string(),
            title: "Release".to_string(),
            date: date.map(|d| d.to_string()),
            status: None,
            disambiguation: None,
            packaging: None,
            country: None,
            media: format.map(|f| {
                vec![MbMedia {
                    position: Some(1),
                    format: Some(f.to_string()),
                    title: None,
                    track_count: None,
                    tracks: None,
                }]
            }),
        }
    }

    #[test]
    fn single_edition_is_always_confident_and_complete_on_exact_title_match() {
        let locals = vec![track("Intro"), track("Outro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let releases = vec![(
            mb_release("r1", None, None),
            vec![mb_track("t1", "Intro"), mb_track("t2", "Outro")],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);

        assert!(result.is_confident);
        assert_eq!(result.status, ReleaseStatus::Complete);
        assert_eq!(result.best_release_id, "r1");
    }

    #[test]
    fn multiple_siblings_one_exact_track_count_is_confident() {
        let locals = vec![track("Intro"), track("Outro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let releases = vec![
            (
                mb_release("r-3tracks", None, None),
                vec![
                    mb_track("t1", "One"),
                    mb_track("t2", "Two"),
                    mb_track("t3", "Three"),
                ],
            ),
            (
                mb_release("r-2tracks", None, None),
                vec![mb_track("t4", "Intro"), mb_track("t5", "Outro")],
            ),
        ];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);

        assert!(result.is_confident);
        assert_eq!(result.best_release_id, "r-2tracks");
        assert_eq!(result.status, ReleaseStatus::Complete);
    }

    #[test]
    fn tiebreak_among_same_count_siblings_prefers_matching_year_then_cd_then_earliest_date() {
        let locals = vec![track("Intro"), track("Outro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        // All three have the same 2-track count. Local year is 2010.
        let releases = vec![
            (
                mb_release("r-wrong-year-vinyl", Some("2005-01-01"), Some("Vinyl")),
                vec![mb_track("a1", "Intro"), mb_track("a2", "Outro")],
            ),
            (
                mb_release("r-right-year-vinyl", Some("2010-06-01"), Some("Vinyl")),
                vec![mb_track("b1", "Intro"), mb_track("b2", "Outro")],
            ),
            (
                mb_release("r-right-year-cd", Some("2010-03-01"), Some("CD")),
                vec![mb_track("c1", "Intro"), mb_track("c2", "Outro")],
            ),
        ];

        let result = check_release_status(&local_refs, &ids, &releases, Some(2010), None);

        assert!(result.is_confident);
        // Same year (2010) narrows to the two 2010 releases; CD narrows to the CD one.
        assert_eq!(result.best_release_id, "r-right-year-cd");
    }

    #[test]
    fn four_track_folder_is_complete_against_a_cd_plus_bluray_edition() {
        // Locks the contract `flatten_audio_tracks` (common::mb::api) relies on: once a CD+Blu-ray
        // release is pre-filtered down to its 4 audio tracks (the MOON incident), it must win the
        // tiebreak against a Digital Media sibling with the same count and be reported COMPLETE - not
        // MISSING_TRACKS from counting the Blu-ray's video track as a 5th expected track.
        let locals = vec![
            track("magnet"),
            track("GATE"),
            track("Kick it"),
            track("mott\u{f6} (JUDY AND MARY cover)"),
        ];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(4);
        let releases = vec![
            (
                mb_release("r-cd", Some("2025-01-01"), Some("CD")),
                vec![
                    mb_track("a1", "magnet"),
                    mb_track("a2", "GATE"),
                    mb_track("a3", "Kick it"),
                    mb_track("a4", "mott\u{f6} (JUDY AND MARY cover)"),
                ],
            ),
            (
                mb_release("r-digital", Some("2025-01-01"), Some("Digital Media")),
                vec![
                    mb_track("b1", "magnet"),
                    mb_track("b2", "GATE"),
                    mb_track("b3", "Kick it"),
                    mb_track("b4", "mott\u{f6} (JUDY AND MARY cover)"),
                ],
            ),
        ];

        let result = check_release_status(&local_refs, &ids, &releases, Some(2025), None);

        assert!(result.is_confident);
        assert_eq!(result.best_release_id, "r-cd");
        assert_eq!(result.status, ReleaseStatus::Complete);
    }

    #[test]
    fn more_local_tracks_than_matched_edition_is_extra_tracks() {
        let locals = vec![track("Intro"), track("Outro"), track("Bonus Track")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(3);
        let releases = vec![(
            mb_release("r1", None, None),
            vec![mb_track("t1", "Intro"), mb_track("t2", "Outro")],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);

        assert_eq!(result.status, ReleaseStatus::ExtraTracks);
    }

    #[test]
    fn fewer_local_tracks_than_matched_edition_is_missing_tracks() {
        let locals = vec![track("Intro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(1);
        let releases = vec![(
            mb_release("r1", None, None),
            vec![mb_track("t1", "Intro"), mb_track("t2", "Outro")],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);

        assert_eq!(result.status, ReleaseStatus::MissingTracks);
    }

    #[test]
    fn no_sibling_with_an_exact_track_count_is_not_confident() {
        let locals = vec![track("Intro"), track("Outro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        // Neither sibling has exactly 2 tracks — can't disambiguate which edition this is.
        let releases = vec![
            (
                mb_release("r-3", None, None),
                vec![
                    mb_track("a1", "One"),
                    mb_track("a2", "Two"),
                    mb_track("a3", "Three"),
                ],
            ),
            (
                mb_release("r-4", None, None),
                vec![
                    mb_track("b1", "One"),
                    mb_track("b2", "Two"),
                    mb_track("b3", "Three"),
                    mb_track("b4", "Four"),
                ],
            ),
        ];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);

        assert!(!result.is_confident);
    }

    #[test]
    fn empty_mb_releases_is_never_confident() {
        let locals = vec![track("Intro")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(1);

        let result = check_release_status(&local_refs, &ids, &[], None, None);

        assert!(!result.is_confident);
        assert_eq!(result.status, ReleaseStatus::Incomplete);
    }

    // -----------------------------------------------------------------------
    // Medium-scoped scoring (docs/sync_decisions.md)
    // -----------------------------------------------------------------------

    #[test]
    fn medium_position_none_scores_against_the_whole_release_unchanged() {
        // Baseline: no medium_position behaves exactly as before this change.
        let locals = vec![track("Disc 1 Track"), track("Disc 2 Track")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let releases = vec![(
            mb_release("box1", None, None),
            vec![
                mb_track_disc("t1", "Disc 1 Track", 1),
                mb_track_disc("t2", "Disc 2 Track", 2),
            ],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, None);
        assert_eq!(result.status, ReleaseStatus::Complete);
    }

    #[test]
    fn a_complete_disc_reads_complete_when_scored_against_its_own_medium_only() {
        // Without medium scoping this single, fully-present disc would read MISSING_TRACKS against
        // the box's full 2-disc tracklist - the false positive this fix exists to close.
        let locals = vec![track("Disc 2 Track A"), track("Disc 2 Track B")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let releases = vec![(
            mb_release("box1", None, None),
            vec![
                mb_track_disc("t1", "Disc 1 Track", 1),
                mb_track_disc("t2", "Disc 2 Track A", 2),
                mb_track_disc("t3", "Disc 2 Track B", 2),
            ],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, Some(2));
        assert_eq!(result.status, ReleaseStatus::Complete);
        assert_eq!(result.matched_mb_tracks.len(), 2);
    }

    #[test]
    fn medium_scoped_missing_tracks_still_detected_within_that_medium() {
        let locals = vec![track("Disc 2 Track A")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(1);
        let releases = vec![(
            mb_release("box1", None, None),
            vec![
                mb_track_disc("t1", "Disc 1 Track", 1),
                mb_track_disc("t2", "Disc 2 Track A", 2),
                mb_track_disc("t3", "Disc 2 Track B", 2),
            ],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, Some(2));
        assert_eq!(result.status, ReleaseStatus::MissingTracks);
    }

    #[test]
    fn medium_scoped_extra_tracks_still_detected_within_that_medium() {
        let locals = vec![track("Disc 2 Track A"), track("Disc 2 Track B"), track("Disc 2 Bonus")];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(3);
        let releases = vec![(
            mb_release("box1", None, None),
            vec![
                mb_track_disc("t1", "Disc 1 Track", 1),
                mb_track_disc("t2", "Disc 2 Track A", 2),
                mb_track_disc("t3", "Disc 2 Track B", 2),
            ],
        )];

        let result = check_release_status(&local_refs, &ids, &releases, None, Some(2));
        assert_eq!(result.status, ReleaseStatus::ExtraTracks);
    }

    #[test]
    fn scope_to_medium_is_a_noop_for_none() {
        let tracks = vec![mb_track_disc("t1", "A", 1), mb_track_disc("t2", "B", 2)];
        assert_eq!(scope_to_medium(&tracks, None).len(), 2);
    }

    #[test]
    fn scope_to_medium_filters_to_exactly_one_disc() {
        let tracks = vec![
            mb_track_disc("t1", "A", 1),
            mb_track_disc("t2", "B", 2),
            mb_track_disc("t3", "C", 2),
        ];
        let scoped = scope_to_medium(&tracks, Some(2));
        assert_eq!(scoped.len(), 2);
        assert!(scoped.iter().all(|t| t.disc_number == Some(2)));
    }
}
