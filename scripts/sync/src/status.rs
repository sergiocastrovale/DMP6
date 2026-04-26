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
}

pub fn check_release_status(
    local_tracks: &[&TrackMeta],
    local_track_ids: &[String],
    mb_releases: &[(MbRelease, Vec<MbTrack>)],
) -> StatusCheck {
    if mb_releases.is_empty() {
        return StatusCheck {
            status: ReleaseStatus::Incomplete,
            matched_mb_tracks: Vec::new(),
            best_release_idx: 0,
            best_release_id: String::new(),
            best_release_disambiguation: None,
        };
    }

    // Pick the best MB release:
    // 1. Exact track count match → use that release
    // 2. No exact match → use the first release (usually the original)
    let local_count = local_tracks.len();
    let best_idx = mb_releases
        .iter()
        .position(|(_, tracks)| tracks.len() == local_count)
        .unwrap_or(0);
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
