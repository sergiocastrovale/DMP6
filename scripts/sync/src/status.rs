use crate::db::LocalTrackRow;
use crate::mb_types::{MbMedia, MbRelease, MbTrack};
use crate::owned::durations_within;
use crate::title_rules::{numbers_disagree, strip_qualifier, titles_near_identical};
use common::types::TrackMeta;
use unicode_normalization::UnicodeNormalization;

/// Build tag-comparison shims from local DB rows. File path, size, mtime, content hash, and the
/// multi-value artist frames are index-time concerns and are never read back from these shims.
pub fn track_metas_from_rows(rows: &[LocalTrackRow]) -> Vec<TrackMeta> {
    let now = chrono::Utc::now().naive_utc();
    rows.iter()
        .map(|t| TrackMeta {
            file_path: String::new(),
            file_size: 0,
            mtime: now,
            title: t.title.clone(),
            artist: t.artist.clone(),
            album_artist: None,
            album: None,
            year: None,
            genre: None,
            track_number: t.track_number,
            disc_number: t.disc_number,
            duration: t.duration,
            bitrate: None,
            sample_rate: None,
            position: None,
            content_hash: String::new(),
            metadata_json: serde_json::Value::Null,
            has_picture: false,
            mb_release_id: t.mb_release_id.clone(),
            mb_release_group_id: t.mb_release_group_id.clone(),
            mb_album_artist_id: t.mb_album_artist_id.clone(),
            artists: Vec::new(),
            album_artists: Vec::new(),
            mb_artist_ids: Vec::new(),
            mb_album_artist_ids: Vec::new(),
        })
        .collect()
}

pub fn format_from_media(media: &Option<Vec<MbMedia>>) -> Option<String> {
    let media = media.as_ref()?;
    let mut formats: Vec<String> = media
        .iter()
        .filter_map(|m| m.format.as_deref())
        .map(|s| s.to_string())
        .collect();
    formats.sort();
    formats.dedup();
    if formats.is_empty() {
        None
    } else {
        Some(formats.join(", "))
    }
}

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
    let words_a: std::collections::HashSet<&str> = na
        .split_whitespace()
        .filter(|w| !noise.contains(w))
        .collect();
    let words_b: std::collections::HashSet<&str> = nb
        .split_whitespace()
        .filter(|w| !noise.contains(w))
        .collect();
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

/// Which title rules `check_release_status` may use. `Extended` is the only one production code runs;
/// `Legacy` exists so the replay harness can score the same release both ways and diff the answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TitleRules {
    #[cfg_attr(not(test), allow(dead_code))]
    Legacy,
    Extended,
}

pub fn check_release_status(
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    mb_releases: &[(MbRelease, Vec<MbTrack>)],
    local_year: Option<i32>,
    medium_position: Option<i32>,
) -> StatusCheck {
    check_release_status_with(
        local_tracks,
        local_track_ids,
        mb_releases,
        local_year,
        medium_position,
        TitleRules::Extended,
    )
}

pub(crate) fn check_release_status_with(
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    mb_releases: &[(MbRelease, Vec<MbTrack>)],
    local_year: Option<i32>,
    medium_position: Option<i32>,
    rules: TitleRules,
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
        let same_title = |(i, local): &(usize, &&TrackMeta)| {
            !used_local.contains(i)
                && normalize_title(local.title.as_deref().unwrap_or("")) == exact
        };
        let hit = match rules {
            TitleRules::Legacy => local_tracks.iter().enumerate().find(same_title),
            // Among several local files with the identical title, take the one whose runtime is
            // closest - not whichever the file order happened to put first. A disc carrying two "The
            // Evening's Young" (190s and 301s, an album take and a 1985 version) used to pair the
            // 301s MusicBrainz track with the 190s file purely because it sorted first, which then
            // stranded the real 190s pairing. It also meant re-scoring a box disc could undo the
            // duration-aware pairing `boxset` had already linked: measured on the library, 26 links
            // across 21 box discs. `min_by_key` keeps the first on a tie, so with no durations known
            // this is exactly the old behaviour.
            TitleRules::Extended => {
                let mb_secs = mb_track.length.map(|ms| (ms / 1000) as i32);
                local_tracks
                    .iter()
                    .enumerate()
                    .filter(same_title)
                    .min_by_key(|(_, local)| match (local.duration, mb_secs) {
                        (Some(a), Some(b)) => (a - b).abs(),
                        _ => i32::MAX,
                    })
            }
        };
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

    // Passes 3 and 4 - the two title rules the box matcher gained in round 2, so the two stop
    // disagreeing about the same tracks (see `title_rules`). Both only ever see what the passes above
    // left unmatched, so they can add a pairing but never undo one.
    if rules == TitleRules::Extended {
        for rule in [LooseRule::BaseTitle, LooseRule::Typo] {
            claim_by_rule(
                rule,
                &mut matched,
                local_tracks,
                local_track_ids,
                &mut used_local,
            );
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

#[derive(Debug, Clone, Copy)]
enum LooseRule {
    /// Equal once each side's trailing "(...)"/"[...]" qualifier is dropped: "Market Square Heroes
    /// (alternative version)" against "Market Square Heroes (re-record)". Neither contains the other,
    /// and their meaningful-word Jaccard is 3/6, so nothing above can see it.
    BaseTitle,
    /// A one- or two-character tagging typo, with both runtimes known and agreeing.
    Typo,
}

/// Runtime agreement required when the two titles carry *different* qualifiers - "(Detroit mix)"
/// against "(original single mix)". The labels disagree, so the runtime is the only evidence these are
/// one recording, and only a near-exact one is good enough.
///
/// Measured on the library: at two seconds or less the pairings were overwhelmingly one slot labelled
/// two ways ("(live, Delicate Sound of Thunder)" / "(2019 remix)" at 278s/278s). Between 3 and 15
/// seconds they were frequently different recordings sharing a base title - "(Paul Humphreys remix)" /
/// "(Theo Kottis remix)", "(overdubbed)" / "(undubbed)", "(mono)" / "(stereo)". Identical titles and
/// near-identical ones (typos) keep the full `SAME_TRACK_DIFFERENT_MASTER_SECS`: their 3-15s pairings
/// sampled as mastering drift, every one.
const QUALIFIERS_DISAGREE_SECS: i32 = 2;

fn rule_fits(rule: LooseRule, mb: &MbTrack, local: &TrackMeta) -> bool {
    use crate::boxset::SAME_TRACK_DIFFERENT_MASTER_SECS as WINDOW;
    let mb_secs = mb.length.map(|ms| (ms / 1000) as i32);
    let local_title = local.title.as_deref().unwrap_or("");
    let both_known = local.duration.is_some() && mb_secs.is_some();
    // A number is identity, not spelling - "Part 2" is not "Part 3", "(take 3)" is not "(take 4)".
    if numbers_disagree(&mb.title, local_title) {
        return false;
    }
    match rule {
        LooseRule::BaseTitle => {
            let a = crate::owned::normalize_title(&strip_qualifier(&mb.title));
            let b = crate::owned::normalize_title(&strip_qualifier(local_title));
            if a.is_empty() || a != b {
                return false;
            }
            let formatting_only = crate::owned::normalize_title(&mb.title)
                == crate::owned::normalize_title(local_title);
            if formatting_only {
                // "Ready, Set, Don't Go" / "Ready,Set,Don't Go", "L.S.D." / "L. S. D." - the titles
                // are identical once punctuation and spacing go, so there is no qualifier to disagree
                // about. Unknown durations stay missing evidence here, as they are everywhere else.
                return durations_within(local.duration, mb_secs, WINDOW);
            }
            // The qualifiers differ, so the runtime is the only thing saying these are one recording:
            // it has to actually be known on both sides, and agree closely. Measured: every pairing
            // that rode in on an unknown MusicBrainz duration with differing qualifiers was a different
            // recording ("(stereo)" / "(mono)", "(instrumental)" / "(Single Version)").
            both_known && durations_within(local.duration, mb_secs, QUALIFIERS_DISAGREE_SECS)
        }
        LooseRule::Typo => {
            both_known
                && durations_within(local.duration, mb_secs, WINDOW)
                && titles_near_identical(
                    &crate::owned::normalize_title(&mb.title),
                    &crate::owned::normalize_title(local_title),
                )
        }
    }
}

/// Pair each still-unmatched MusicBrainz track with a still-unused local track under `rule`, but only
/// where the pairing is unique **in both directions**: exactly one local track fits the MB track, and
/// that local track fits no other unmatched MB track.
///
/// Stricter than the box matcher's one-directional uniqueness on purpose. This decides the status of
/// every release in the library, not only box discs, and a looser rule's failure mode here is a false
/// `COMPLETE` - so the only pairings taken are ones no other track could contest.
///
/// Every decision is made against the state *before* this pass claims anything, so the result cannot
/// depend on which track happened to be examined first. Two claims can never collide: a local track
/// that fits two MB tracks is refused, and so is an MB track that fits two local tracks.
fn claim_by_rule(
    rule: LooseRule,
    matched: &mut [(MbTrack, Option<String>)],
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    used_local: &mut std::collections::HashSet<usize>,
) {
    let pending: Vec<usize> = (0..matched.len())
        .filter(|&mi| matched[mi].1.is_none())
        .collect();
    let mut claims: Vec<(usize, usize)> = Vec::new();
    for &mi in &pending {
        let fits: Vec<usize> = (0..local_tracks.len())
            .filter(|li| {
                !used_local.contains(li) && rule_fits(rule, &matched[mi].0, local_tracks[*li])
            })
            .collect();
        let [li] = fits[..] else {
            continue;
        };
        let contested = pending
            .iter()
            .filter(|&&other| rule_fits(rule, &matched[other].0, local_tracks[li]))
            .count()
            > 1;
        if !contested {
            claims.push((mi, li));
        }
    }
    for (mi, li) in claims {
        used_local.insert(li);
        matched[mi].1 = Some(local_track_ids[li].clone());
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

    #[test]
    fn normalize_title_folds_accents_and_keeps_word_boundaries() {
        assert_eq!(normalize_title("Café"), "cafe");
        assert_eq!(normalize_title("Bangers + Mash"), "bangers mash");
        assert_eq!(normalize_title("Mk  1"), "mk 1");
        assert_ne!(normalize_title("Mk 1"), normalize_title("Mk1"));
        assert_eq!(
            normalize_title("Ring Ring (English Version)"),
            "ring ring english version"
        );
    }

    #[test]
    fn year_from_date_takes_the_leading_year() {
        assert_eq!(year_from_date(Some("1975-03-01")), Some(1975));
        assert_eq!(year_from_date(Some("1975")), Some(1975));
        assert_eq!(year_from_date(Some("")), None);
        assert_eq!(year_from_date(Some("abcd-01")), None);
        assert_eq!(year_from_date(None), None);
    }
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

    /// Differential harness for the scorer: scores every release in a library dump with both the
    /// `Legacy` and `Extended` title rules and reports every status that changed and every new
    /// pairing the extended rules made. `#[ignore]`d - it needs a dump - and run by hand:
    ///
    /// ```text
    /// STATUS_DUMP=/path/status_dump.tsv STATUS_OUT=/path/report.txt \
    ///   cargo test -p sync replay_status_dump -- --ignored
    /// ```
    ///
    /// Tab-separated, Postgres `\copy` text format, three record kinds:
    /// `R  localReleaseId  mbReleaseId  mediumPosition  year  currentStatus`,
    /// `L  localReleaseId  trackId  title  seconds`,
    /// `M  mbReleaseId  trackId  title  milliseconds  discNumber  position`.
    ///
    /// `check_release_status` decides the status of every release in the library, so a unit test
    /// cannot answer the only question that matters when its title rules change: does anything move
    /// that should not. This does.
    #[test]
    #[ignore]
    fn replay_status_dump() {
        use std::collections::HashMap;
        use std::fmt::Write as _;
        let Ok(path) = std::env::var("STATUS_DUMP") else {
            eprintln!("set STATUS_DUMP");
            return;
        };
        let unescape = |s: &str| s.replace("\\\\", "\\");
        let num = |s: &str| s.parse::<i32>().ok();

        struct ReleaseDumpRow {
            local_id: String,
            mb_id: String,
            medium: Option<i32>,
            year: Option<i32>,
            db_status: String,
        }
        let mut releases: Vec<ReleaseDumpRow> = Vec::new();
        let mut locals: HashMap<String, Vec<LocalTrackRow>> = HashMap::new();
        let mut mbs: HashMap<String, Vec<MbTrack>> = HashMap::new();
        for line in std::fs::read_to_string(&path).unwrap().lines() {
            let f: Vec<&str> = line.split('\t').collect();
            match f.first() {
                Some(&"R") if f.len() >= 6 => releases.push(ReleaseDumpRow {
                    local_id: f[1].to_string(),
                    mb_id: f[2].to_string(),
                    medium: num(f[3]),
                    year: num(f[4]),
                    db_status: f[5].to_string(),
                }),
                Some(&"L") if f.len() >= 5 => {
                    locals
                        .entry(f[1].to_string())
                        .or_default()
                        .push(LocalTrackRow {
                            id: f[2].to_string(),
                            title: Some(unescape(f[3])),
                            artist: None,
                            album: None,
                            year: None,
                            mb_release_id: None,
                            mb_release_group_id: None,
                            mb_album_artist_id: None,
                            track_number: None,
                            disc_number: None,
                            duration: num(f[4]),
                        })
                }
                Some(&"M") if f.len() >= 7 => {
                    mbs.entry(f[1].to_string()).or_default().push(MbTrack {
                        id: f[2].to_string(),
                        title: unescape(f[3]),
                        position: f[6].parse().ok(),
                        length: f[4].parse().ok(),
                        disc_number: f[5].parse().ok(),
                        recording: None,
                    })
                }
                _ => {}
            }
        }

        let mut transitions: HashMap<(String, String), usize> = HashMap::new();
        let (mut scored, mut legacy_agrees_with_db) = (0usize, 0usize);
        let mut new_pairs = String::new();
        let mut new_pair_count = 0usize;
        for row in &releases {
            let (local_id, mb_id, medium, year, db_status) = (
                &row.local_id,
                &row.mb_id,
                row.medium,
                row.year,
                &row.db_status,
            );
            let (Some(rows), Some(tracks)) = (locals.get(local_id), mbs.get(mb_id)) else {
                continue;
            };
            let metas = track_metas_from_rows(rows);
            let refs: Vec<&TrackMeta> = metas.iter().collect();
            let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
            let release = MbRelease {
                id: mb_id.clone(),
                title: String::new(),
                date: None,
                status: None,
                disambiguation: None,
                packaging: None,
                country: None,
                media: None,
            };
            let candidates = [(release, tracks.clone())];
            let old = check_release_status_with(
                &refs,
                &ids,
                &candidates,
                year,
                medium,
                TitleRules::Legacy,
            );
            let new = check_release_status_with(
                &refs,
                &ids,
                &candidates,
                year,
                medium,
                TitleRules::Extended,
            );
            scored += 1;
            let old_s = status_to_db_string(&old.status).to_string();
            let new_s = status_to_db_string(&new.status).to_string();
            if &old_s == db_status {
                legacy_agrees_with_db += 1;
            }
            if old_s != new_s {
                writeln!(new_pairs, "FLIP\t{local_id}\t{old_s}\t{new_s}").unwrap();
            }
            let linked = |c: &StatusCheck| {
                c.matched_mb_tracks
                    .iter()
                    .filter(|(_, l)| l.is_some())
                    .count()
            };
            writeln!(
                new_pairs,
                "MATCHED\t{local_id}\t{}\t{}",
                linked(&old),
                linked(&new)
            )
            .unwrap();
            *transitions.entry((old_s, new_s)).or_default() += 1;

            for (i, (mb_track, lid)) in new.matched_mb_tracks.iter().enumerate() {
                let was = old.matched_mb_tracks.get(i).and_then(|(_, l)| l.clone());
                let (Some(lid), None) = (lid, was) else {
                    continue;
                };
                let local = rows.iter().find(|r| &r.id == lid).unwrap();
                new_pair_count += 1;
                writeln!(
                    new_pairs,
                    "PAIR\t{}\t{}\t{}\t{}\t{}",
                    local_id,
                    mb_track.title,
                    local.title.as_deref().unwrap_or(""),
                    mb_track
                        .length
                        .map(|ms| (ms / 1000).to_string())
                        .unwrap_or_default(),
                    local.duration.map(|d| d.to_string()).unwrap_or_default()
                )
                .unwrap();
            }
        }

        let mut report = format!(
            "scored {scored}; legacy rules reproduce the stored status on {legacy_agrees_with_db}; new pairings {new_pair_count}\n"
        );
        let mut rows: Vec<_> = transitions.into_iter().collect();
        rows.sort();
        for ((from, to), n) in rows {
            writeln!(report, "{from} -> {to}\t{n}").unwrap();
        }
        report.push_str(&new_pairs);
        println!("{report}");
        if let Ok(out) = std::env::var("STATUS_OUT") {
            std::fs::write(out, report).ok();
        }
    }

    #[test]
    fn track_metas_from_rows_carries_the_comparison_fields_and_drops_the_rest() {
        let rows = vec![crate::db::LocalTrackRow {
            id: "t1".into(),
            title: Some("Ring Ring".into()),
            artist: Some("ABBA".into()),
            album: None,
            year: None,
            mb_release_id: Some("mb-release".into()),
            mb_release_group_id: Some("mb-rg".into()),
            mb_album_artist_id: Some("mb-artist".into()),
            track_number: Some(1),
            disc_number: Some(2),
            duration: Some(185),
        }];

        let metas = track_metas_from_rows(&rows);

        assert_eq!(metas.len(), 1);
        let m = &metas[0];
        assert_eq!(m.title.as_deref(), Some("Ring Ring"));
        assert_eq!(m.artist.as_deref(), Some("ABBA"));
        assert_eq!(m.mb_release_id.as_deref(), Some("mb-release"));
        assert_eq!(m.mb_release_group_id.as_deref(), Some("mb-rg"));
        assert_eq!(m.mb_album_artist_id.as_deref(), Some("mb-artist"));
        assert_eq!(m.track_number, Some(1));
        assert_eq!(m.disc_number, Some(2));
        assert_eq!(
            m.duration,
            Some(185),
            "the looser title rules need a real runtime to compare"
        );
        // File-path/hash/multi-value fields are a DB-row shim only, never read back from here.
        assert_eq!(m.file_path, "");
        assert_eq!(m.content_hash, "");
        assert!(m.artists.is_empty());
        assert!(m.album_artists.is_empty());
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

    fn timed(title: &str, secs: i32) -> TrackMeta {
        TrackMeta {
            duration: Some(secs),
            ..track(title)
        }
    }

    fn mb_timed(id: &str, title: &str, secs: u64) -> MbTrack {
        MbTrack {
            length: Some(secs * 1000),
            ..mb_track(id, title)
        }
    }

    fn score(locals: &[TrackMeta], mb: Vec<MbTrack>, rules: TitleRules) -> ReleaseStatus {
        let refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(locals.len());
        check_release_status_with(
            &refs,
            &ids,
            &[(mb_release("r1", None, None), mb)],
            None,
            None,
            rules,
        )
        .status
    }

    /// Marillion's "The Singles '82-88'" disc 4, the release that started this: every track present,
    /// runtimes agreeing to the second, and still `MISSING_TRACKS` because one bonus track is labelled
    /// "(alternative version)" where MusicBrainz says "(re-record)". Scored both ways, so the test fails
    /// if it ever stops exercising the new rule - a regression test that passes under the old code
    /// provides no coverage (see `exact_titles_are_claimed_before_a_loose_match_can_steal_one`).
    #[test]
    fn a_differently_qualified_title_now_scores_complete() {
        let locals = vec![
            timed("Punch and Judy", 200),
            timed("Market Square Heroes (re-record edit)", 240),
            timed("Three Boats Down From the Candy (re-record)", 242),
            timed("Market Square Heroes (alternative version)", 288),
        ];
        let mb = || {
            vec![
                mb_timed("m1", "Punch and Judy", 200),
                mb_timed("m2", "Market Square Heroes (re‐record edit)", 240),
                mb_timed("m3", "Three Boats Down From the Candy (re‐record)", 242),
                mb_timed("m4", "Market Square Heroes (re‐record)", 288),
            ]
        };
        assert_eq!(
            score(&locals, mb(), TitleRules::Legacy),
            ReleaseStatus::MissingTracks
        );
        assert_eq!(
            score(&locals, mb(), TitleRules::Extended),
            ReleaseStatus::Complete
        );
    }

    /// When the qualifiers disagree the runtime is the only evidence of sameness, so it must be known
    /// on both sides and agree closely. Measured on the library: "(mono)" paired with "(stereo)" purely
    /// because MusicBrainz had no length for the stereo track.
    #[test]
    fn differing_qualifiers_need_a_known_and_close_runtime() {
        let locals = vec![timed("Intro", 60), timed("Clown (mono)", 130)];
        let with = |mb_clown: MbTrack| vec![mb_timed("m1", "Intro", 60), mb_clown];
        assert_eq!(
            score(
                &locals,
                with(mb_track("m2", "Clown (stereo)")),
                TitleRules::Extended
            ),
            ReleaseStatus::MissingTracks,
            "an unknown MusicBrainz runtime is no evidence at all here"
        );
        assert_eq!(
            score(
                &locals,
                with(mb_timed("m2", "Clown (stereo)", 140)),
                TitleRules::Extended
            ),
            ReleaseStatus::MissingTracks,
            "ten seconds apart with disagreeing labels is two recordings"
        );
        assert_eq!(
            score(
                &locals,
                with(mb_timed("m2", "Clown (single version)", 131)),
                TitleRules::Extended
            ),
            ReleaseStatus::Complete,
            "a second apart, the file is in that slot whatever the label says"
        );
    }

    /// Yello's "Claro Que Si" disc: two files titled "The Evening's Young" (190s album take, 301s
    /// longer take). The exact pass used to hand the MusicBrainz 301s track whichever file sorted first
    /// - the 190s one - stranding the real 190s pairing. Among identical titles it now takes the
    ///   closest runtime. Scored both ways so the test cannot pass under the old behaviour.
    #[test]
    fn identical_titles_pair_by_closest_runtime_not_file_order() {
        let locals = [
            timed("The Evening's Young", 190),
            timed("The Evening's Young", 301),
        ];
        let refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let mb = || {
            vec![
                mb_timed("m1", "The Evening's Young", 301),
                mb_timed("m2", "The Evening's Young", 190),
            ]
        };
        let paired = |rules| {
            check_release_status_with(
                &refs,
                &ids,
                &[(mb_release("r1", None, None), mb())],
                None,
                None,
                rules,
            )
            .matched_mb_tracks
            .into_iter()
            .map(|(t, l)| (t.id, l.unwrap()))
            .collect::<std::collections::HashMap<_, _>>()
        };
        assert_eq!(
            paired(TitleRules::Legacy)["m1"],
            ids[0],
            "old: file order wins"
        );
        let new = paired(TitleRules::Extended);
        assert_eq!(new["m1"], ids[1], "301s track takes the 301s file");
        assert_eq!(new["m2"], ids[0], "190s track takes the 190s file");
    }

    #[test]
    fn a_different_take_number_is_never_the_same_track() {
        let locals = vec![timed("Intro", 60), timed("Rip It Up (take 4)", 180)];
        let mb = vec![
            mb_timed("m1", "Intro", 60),
            mb_timed("m2", "Rip It Up (take 10)", 180),
        ];
        assert_eq!(
            score(&locals, mb, TitleRules::Extended),
            ReleaseStatus::MissingTracks
        );
    }

    /// Two local files could each be either MusicBrainz track - the scorer must refuse rather than
    /// guess, since a guess here is a status the user reads as fact.
    #[test]
    fn a_pairing_either_side_could_contest_is_refused() {
        let locals = vec![timed("Song (demo)", 200), timed("Song (rehearsal)", 201)];
        let mb = vec![
            mb_timed("m1", "Song (live)", 200),
            mb_timed("m2", "Song (take)", 201),
        ];
        assert_eq!(
            score(&locals, mb, TitleRules::Extended),
            ReleaseStatus::MissingTracks
        );
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
        let locals = [
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
        assert_eq!(
            by_mb_id["m1"],
            Some(ids[2].as_str()),
            "plain title must pair with the plain file"
        );
        assert_eq!(
            by_mb_id["m2"],
            Some(ids[3].as_str()),
            "remake must pair with the remake file"
        );
        assert_eq!(
            by_mb_id["m3"],
            Some(ids[0].as_str()),
            "take 3 must pair with the take-3 file"
        );
        assert_eq!(
            by_mb_id["m4"],
            Some(ids[1].as_str()),
            "take 4 must pair with the take-4 file"
        );
    }

    /// Even when old code got the *status* right, it could still get the *pairing* wrong - swapping
    /// which local file a duplicate-ish MB track links to. That is a data-correctness issue on its own
    /// (wrong recording linked to wrong file) independent of whether it happens to change the reported
    /// completeness.
    #[test]
    fn exact_pairing_holds_even_when_a_loose_match_would_have_produced_the_same_status() {
        let locals = [
            track("Song A (Extended)"), // deliberately the *loose* candidate first
            track("Song A"),
        ];
        let local_refs: Vec<&TrackMeta> = locals.iter().collect();
        let ids = track_ids(2);
        let mb_tracks = vec![
            mb_track("m1", "Song A"),
            mb_track("m2", "Song A (Extended)"),
        ];
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
        let locals = [track("Intro"), track("Outro")];
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
        let locals = [track("Intro"), track("Outro")];
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
        let locals = [track("Intro"), track("Outro")];
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
        let locals = [
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
        let locals = [track("Intro"), track("Outro"), track("Bonus Track")];
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
        let locals = [track("Intro")];
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
        let locals = [track("Intro"), track("Outro")];
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
        let locals = [track("Intro")];
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
        let locals = [track("Disc 1 Track"), track("Disc 2 Track")];
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
        let locals = [track("Disc 2 Track A"), track("Disc 2 Track B")];
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
        let locals = [track("Disc 2 Track A")];
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
        let locals = [
            track("Disc 2 Track A"),
            track("Disc 2 Track B"),
            track("Disc 2 Bonus"),
        ];
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
