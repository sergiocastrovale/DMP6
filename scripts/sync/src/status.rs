use crate::mb_types::{MbRelease, MbTrack};
use common::types::TrackMeta;

// ---------------------------------------------------------------------------
// Title normalisation
// ---------------------------------------------------------------------------

pub fn normalize_title(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

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
    // Jaccard on word sets as fallback
    let words_a: std::collections::HashSet<&str> = na.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = nb.split_whitespace().collect();
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
    // When false, callers must NOT bind LocalRelease.releaseId — leave Unmatched.
    pub is_confident: bool,
}

fn year_from_date(d: Option<&str>) -> Option<i32> {
    d.and_then(|s| s.split('-').next()).and_then(|y| y.parse::<i32>().ok())
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

pub fn check_release_status(
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    mb_releases: &[(MbRelease, Vec<MbTrack>)],
    local_year: Option<i32>,
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

    let exact_matches: Vec<usize> = mb_releases
        .iter()
        .enumerate()
        .filter(|(_, (_, tracks))| tracks.len() == local_count)
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

    let mb_tracks = &best_release.1;
    let mb_count = mb_tracks.len();

    // Match local tracks → MB tracks by title
    let mut matched: Vec<(MbTrack, Option<String>)> = Vec::new();
    let mut used_local: std::collections::HashSet<usize> = Default::default();

    for mb_track in mb_tracks {
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
            matched.push((mb_track.clone(), Some(local_track_ids[idx].clone())));
        } else {
            matched.push((mb_track.clone(), None));
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
