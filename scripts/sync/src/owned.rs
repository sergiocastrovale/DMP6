//! "Recordings already inside another release" — the annotation that tells the catalogue where a
//! missing release's songs can already be heard, without ever claiming the release itself is owned.
//!
//! MusicBrainz models a bonus disc, and every album reissued inside a box set or a complete-recordings
//! collection, as its own release group. A local folder holding the box binds to the box's group, so
//! each contained album's group has no bind of its own and reads as a catalogue gap.
//!
//! It is a gap. Holding a box set's rendition of an album is **not** holding that album: different
//! edition, usually a different master, often different edits or takes. DMP exists to tell a collector
//! what they actually have, so a contained release stays MISSING, stays counted as a gap, and stays
//! acquirable. All we add is a note naming the local release those recordings already sit in, so the
//! collector can judge how badly they want a standalone copy.
//!
//! Deliberately NOT done here: writing anything onto the local files or their track links. The local
//! tracks belong to the container and already carry its MB identity; repointing them at this release's
//! tracks would destroy that identity and stamp a mismatched album/track id pair into the tags.

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
/// played live, so a title-only rule reads it as contained. Its takes run 1-33s off the studio ones;
/// masterings and remasters of the same recording differ by well under this. Since containment needs
/// EVERY track to match, one honest outlier is enough to refuse.
pub(crate) const DURATION_TOLERANCE_SECS: i32 = 5;

/// Unknown duration on either side cannot refute a title match — it is missing evidence, not counter-
/// evidence. (Local durations come from the file; MB's `length` is frequently absent on older data.)
pub(crate) fn durations_compatible(local_secs: Option<i32>, mb_secs: Option<i32>) -> bool {
    durations_within(local_secs, mb_secs, DURATION_TOLERANCE_SECS)
}

/// `durations_compatible` with an explicit window, for the callers that deliberately widen it
/// (`boxset::pair_tracks`' later passes). Split out so the "unknown is not counter-evidence" rule
/// above has exactly one implementation — that half must never drift between windows.
pub(crate) fn durations_within(local_secs: Option<i32>, mb_secs: Option<i32>, secs: i32) -> bool {
    match (local_secs, mb_secs) {
        (Some(a), Some(b)) => (a - b).abs() <= secs,
        _ => true,
    }
}

/// Smallest MB release worth annotating. A one- or two-track "release" would match by coincidence
/// inside any album; the cases this exists for are always substantially longer.
const MIN_CONTAINED_TRACKS: usize = 3;

/// Which local release already contains **every** track of `mb_titles`, and which of its tracks they
/// are (parallel to `mb_titles`, so the caller can link track-for-track).
///
/// Strict by design: every MB track must be present, each consuming a distinct local track. Partial
/// overlap says nothing — a deluxe edition sharing 9 of 12 tracks with the standard one is simply a
/// different release.
///
/// The bundle must be a **strict superset** (more tracks than the MB release). An exact-size match is
/// the ordinary "this folder *is* that release" case, which belongs to the matcher.
pub fn find_owning_bundle<'a>(
    mb_tracks: &[(String, Option<i32>)],
    bundles: &'a [LocalBundle],
) -> Option<(&'a LocalBundle, Vec<String>)> {
    if mb_tracks.len() < MIN_CONTAINED_TRACKS {
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

/// Title of the local release whose tracks already cover every track of this release group, if there
/// is one.
///
/// Pure and side-effect free: it returns nothing but a name for the caller to put in the gap's
/// `statusReason`. The release is still a gap — see the module docs for why containment is not
/// ownership.
///
/// `editions` arrives pre-fetched from the caller's `OfficialArtistCatalogue`. It used to fetch them
/// itself, one paginated MusicBrainz browse per gap per artist per run, with negative results never
/// cached — the single largest avoidable cost in a sync run (14.8 such calls for an average artist,
/// 813 at worst, each averaging ~10s cold). The artist's whole official catalogue now arrives in the
/// browse sync already made for `official_rg_ids`, so this costs nothing.
pub fn detect_containment(
    editions: &[(crate::mb_types::MbRelease, Vec<crate::mb_types::MbTrack>)],
    bundles: &[LocalBundle],
) -> Option<String> {
    if bundles.is_empty() {
        return None;
    }

    // Widest edition first: containment of the fullest tracklist is the strongest statement.
    let mut ordered: Vec<&(crate::mb_types::MbRelease, Vec<crate::mb_types::MbTrack>)> =
        editions.iter().collect();
    ordered.sort_by_key(|(_, tracks)| std::cmp::Reverse(tracks.len()));

    for (_, tracks) in ordered {
        let mb_tracks: Vec<(String, Option<i32>)> = tracks
            .iter()
            .map(|t| (t.title.clone(), t.length.map(|ms| (ms / 1000) as i32)))
            .collect();
        if let Some((bundle, _)) = find_owning_bundle(&mb_tracks, bundles) {
            return Some(bundle.title.clone());
        }
    }
    None
}

/// The note stored on the gap's `statusReason`, and the prefix the web app keys its badge off.
pub fn containment_note(container_title: &str) -> String {
    format!("Recordings inside \"{}\"", container_title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_title_keeps_only_lowercased_alphanumerics() {
        assert_eq!(normalize_title("Bangers + Mash"), "bangersmash");
        assert_eq!(normalize_title("Mk 1"), "mk1");
        assert_eq!(normalize_title("MK1"), "mk1");
        assert_eq!(normalize_title("Café"), "café");
        assert_eq!(normalize_title("  "), "");
    }

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
        v.iter()
            .map(|(s, secs)| (s.to_string(), Some(*secs)))
            .collect()
    }

    // The real case: a folder holding CD 01 + CD 02 of In Rainbows, versus MusicBrainz's separate
    // "In Rainbows Disk 2" release group.
    #[test]
    fn detects_a_bonus_disc_sitting_inside_a_two_disc_folder() {
        let local = bundle(
            "in-rainbows",
            &[
                "15 Step",
                "Bodysnatchers",
                "Nude",
                "Weird Fishes",
                "All I Need",
                "Faust Arp",
                "Reckoner",
                "House of Cards",
                "Jigsaw Falling Into Place",
                "Videotape",
                "Mk 1",
                "Down Is the New Up",
                "Go Slowly",
                "Mk 2",
                "Last Flowers",
                "Up on the Ladder",
                "Bangers + Mash",
                "4 Minute Warning",
            ],
        );
        let disk2 = titles(&[
            "MK 1",
            "Down Is the New Up",
            "Go Slowly",
            "MK 2",
            "Last Flowers",
            "Up on the Ladder",
            "Bangers + Mash",
            "4 Minute Warning",
        ]);
        let bundles = [local];
        let (owner, matched) =
            find_owning_bundle(&disk2, &bundles).expect("bundle contains disk 2");
        assert_eq!(owner.release_id, "in-rainbows");
        assert_eq!(matched.len(), 8);
        assert_eq!(matched[0], "in-rainbows-t10"); // "Mk 1", not disc 1's opener
    }

    // The false positive that titles alone let through: "In Rainbows: From the Basement" is the same
    // ten songs as the album, performed live. Real durations from MusicBrainz and the local files.
    #[test]
    fn a_live_rerecording_of_the_same_songs_is_not_contained() {
        let album = timed_bundle(
            "in-rainbows",
            &[
                ("15 Step", 237),
                ("Bodysnatchers", 242),
                ("Nude", 255),
                ("Weird Fishes/Arpeggi", 318),
                ("All I Need", 228),
                ("Faust Arp", 129),
                ("Reckoner", 290),
                ("House of Cards", 328),
                ("Jigsaw Falling Into Place", 248),
                ("Videotape", 279),
                ("Mk 1", 66),
                ("Down Is the New Up", 300),
            ],
        );
        let from_the_basement = timed(&[
            ("15 Step", 236),
            ("Bodysnatchers", 256),
            ("House of Cards", 329),
            ("Bangers + Mash", 211),
            ("Videotape", 287),
            ("Reckoner", 303),
            ("Go Slowly", 234),
            ("All I Need", 261),
            ("Nude", 261),
            ("Weird Fishes/Arpeggi", 320),
        ]);
        assert!(find_owning_bundle(&from_the_basement, &[album]).is_none());
    }

    #[test]
    fn the_same_recording_still_matches_across_a_small_encoding_drift() {
        let local = timed_bundle(
            "two-disc",
            &[
                ("A", 200),
                ("B", 200),
                ("C", 200),
                ("D", 200),
                ("Mk 1", 66),
                ("Down Is the New Up", 300),
                ("Go Slowly", 234),
            ],
        );
        let disc_two = timed(&[
            ("Mk 1", 67),
            ("Down Is the New Up", 299),
            ("Go Slowly", 234),
        ]);
        assert!(find_owning_bundle(&disc_two, &[local]).is_some());
    }

    #[test]
    fn one_missing_track_is_not_containment() {
        let local = bundle("album", &["A", "B", "C", "D", "E"]);
        assert!(find_owning_bundle(&titles(&["A", "B", "X"]), &[local]).is_none());
    }

    // An exact-size match is the matcher's job (bind the folder), not a containment note.
    #[test]
    fn an_exact_size_match_is_left_to_the_matcher() {
        let local = bundle("ep", &["A", "B", "C"]);
        assert!(find_owning_bundle(&titles(&["A", "B", "C"]), &[local]).is_none());
    }

    #[test]
    fn tiny_releases_are_never_annotated() {
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
    fn the_note_names_the_container_without_claiming_ownership() {
        assert_eq!(
            containment_note("The First Four Years"),
            "Recordings inside \"The First Four Years\""
        );
    }

    #[test]
    fn punctuation_and_case_do_not_block_a_match() {
        assert_eq!(normalize_title("Bangers + Mash"), "bangersmash");
        assert_eq!(normalize_title("MK 1"), normalize_title("Mk 1"));
    }
}
