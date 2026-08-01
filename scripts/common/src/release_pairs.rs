use crate::filters::normalize_filter;

#[derive(Debug, PartialEq, Eq)]
pub enum ReleasePairKind {
    DuplicateRelease,
    MismatchedReleaseId,
    Skip,
}

const DURATION_TOLERANCE_SECS: i64 = 30;

/// Classify a pair of LocalReleases that share the same MusicBrainzRelease id.
/// Same normalized title + matching track count + close duration => likely the same
/// edition ripped twice (DuplicateRelease). Different title => the sync matcher linked
/// unrelated albums to the same MB release row (MismatchedReleaseId).
pub fn classify_release_pair(
    title_a: &str,
    title_b: &str,
    duration_a: Option<i64>,
    duration_b: Option<i64>,
    tracks_a: i64,
    tracks_b: i64,
) -> ReleasePairKind {
    if normalize_filter(title_a) == normalize_filter(title_b) {
        let tracks_match = tracks_a == tracks_b;
        let duration_close = match (duration_a, duration_b) {
            (Some(a), Some(b)) => (a - b).abs() <= DURATION_TOLERANCE_SECS,
            _ => true,
        };
        if tracks_match && duration_close {
            ReleasePairKind::DuplicateRelease
        } else {
            ReleasePairKind::Skip
        }
    } else {
        ReleasePairKind::MismatchedReleaseId
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_title_matching_tracks_and_close_duration_is_duplicate() {
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", Some(2068), Some(2062), 10, 10),
            ReleasePairKind::DuplicateRelease
        );
    }

    #[test]
    fn title_normalization_ignores_case_and_punctuation() {
        assert_eq!(
            classify_release_pair("Guitar Town", "GUITAR TOWN!", Some(2068), Some(2062), 10, 10),
            ReleasePairKind::DuplicateRelease
        );
    }

    #[test]
    fn same_title_different_track_count_is_skipped() {
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", Some(2068), Some(2062), 10, 11),
            ReleasePairKind::Skip
        );
    }

    #[test]
    fn same_title_far_apart_duration_is_skipped() {
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", Some(2000), Some(2600), 10, 10),
            ReleasePairKind::Skip
        );
    }

    #[test]
    fn missing_duration_falls_back_to_track_count_only() {
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", None, Some(2062), 10, 10),
            ReleasePairKind::DuplicateRelease
        );
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", None, Some(2062), 10, 11),
            ReleasePairKind::Skip
        );
    }

    #[test]
    fn different_titles_are_mismatched_regardless_of_tracks_or_duration() {
        assert_eq!(
            classify_release_pair("My Blue Heaven", "The Complete School For Pianists", Some(2068), Some(2062), 10, 10),
            ReleasePairKind::MismatchedReleaseId
        );
    }

    #[test]
    fn duration_diff_boundary_30s_is_duplicate_31s_is_skip() {
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", Some(2000), Some(2030), 10, 10),
            ReleasePairKind::DuplicateRelease
        );
        assert_eq!(
            classify_release_pair("Guitar Town", "Guitar Town", Some(2000), Some(2031), 10, 10),
            ReleasePairKind::Skip
        );
    }
}
