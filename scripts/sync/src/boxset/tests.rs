use super::*;
use crate::title_rules::strip_qualifier;
use std::collections::HashSet;

/// The regression: scoping used to compare `--only` against the *parent path*, which
/// `matches_filter` normalizes to `abbacompilation2005 the complete...`. Under `--exact` that can
/// never equal `abba`, so every `--only X --exact` sync skipped box-set repair while reporting
/// "0 sibling-folder group(s)" - indistinguishable from the artist genuinely having none.
/// The regression that left ABBA's "The Complete Studio Recordings (9CD)" unbound: a perfect
/// 9-of-9 rip whose disc 1 holds exactly MusicBrainz's 19 tracks in a different sequence. Matching
/// by position rejected that disc, and one rejected sibling rejects the whole group.
#[test]
fn a_disc_sequenced_differently_still_matches_the_same_medium() {
    let local = sibling(
        "cd1",
        "Box/CD 1",
        &[
            ("l1", "Ring Ring", Some(184)),
            ("l2", "Åh, vilka tider", Some(153)),
            ("l3", "Rock'n Roll Band", Some(190)),
        ],
    );
    let m = medium(
        1,
        &[
            ("m1", "Ring Ring", Some(186)),
            ("m2", "Rock ’n Roll Band", Some(194)),
            ("m3", "Åh, vilka tider", Some(153)),
        ],
    );
    let links = pair_tracks(&local.tracks, &m.tracks).expect("same set, different order");
    // Each local track links to its own recording, not to whatever sat at the same index.
    assert_eq!(
        links,
        vec![
            ("l1".to_string(), "m1".to_string()),
            ("l2".to_string(), "m3".to_string()),
            ("l3".to_string(), "m2".to_string()),
        ]
    );
}

/// ABBA's "The Complete Studio Recordings" disc 1: a perfect 19-of-19 rip whose opener is tagged
/// with a qualifier MusicBrainz leaves off. One word rejected the whole nine-disc box.
#[test]
fn a_qualified_title_pairs_with_the_plain_one() {
    let local = sibling(
        "cd1",
        "Box/CD 1",
        &[
            ("l1", "Ring Ring (English version)", Some(184)),
            ("l2", "Another Town, Another Train", Some(193)),
            ("l3", "Nina, Pretty Ballerina", Some(174)),
        ],
    );
    let m = medium(
        1,
        &[
            ("m1", "Ring Ring", Some(186)),
            ("m2", "Another Town, Another Train", Some(193)),
            ("m3", "Nina, Pretty Ballerina", Some(173)),
        ],
    );
    let links =
        pair_tracks(&local.tracks, &m.tracks).expect("qualifier must not block the pairing");
    // Keyed, not indexed: exact matches are claimed first, so the loose pair lands last.
    let by_local: std::collections::HashMap<_, _> = links.into_iter().collect();
    assert_eq!(by_local["l1"], "m1");
    assert_eq!(by_local["l2"], "m2");
    assert_eq!(by_local["l3"], "m3");
}

/// The hazard the two passes exist to avoid. That same disc carries four language versions of
/// "Ring Ring" whose durations all sit within tolerance of the plain one, so a greedy
/// substring-first scan would pair whichever happened to come first. Exact titles must be claimed
/// before any loose match is considered.
#[test]
fn an_exact_title_is_claimed_before_a_loose_one_competes_for_it() {
    let local = sibling(
        "cd1",
        "Box/CD 1",
        &[
            ("l1", "Ring Ring (Spanish version)", Some(182)),
            ("l2", "Ring Ring (English version)", Some(184)),
            ("l3", "Santa Rosa", Some(181)),
        ],
    );
    let m = medium(
        1,
        &[
            ("m1", "Ring Ring", Some(186)),
            ("m2", "Ring Ring (Spanish version)", Some(181)),
            ("m3", "Santa Rosa", Some(181)),
        ],
    );
    let links = pair_tracks(&local.tracks, &m.tracks).expect("should pair");
    let by_local: std::collections::HashMap<_, _> = links.into_iter().collect();
    assert_eq!(
        by_local["l1"], "m2",
        "the Spanish tag must take the Spanish track"
    );
    assert_eq!(
        by_local["l2"], "m1",
        "the English tag takes the plain one that is left"
    );
}

/// ABBA's disc 5: eleven titles line up exactly, one runtime is six seconds out, and that used to
/// reject the entire nine-disc box.
#[test]
fn a_few_seconds_of_master_drift_does_not_reject_a_disc() {
    let local = sibling(
        "cd5",
        "Box/CD 5",
        &[
            ("l1", "Eagle", Some(349)),
            ("l2", "I'm a Marionette", Some(243)),
            ("l3", "Thank You for the Music", Some(229)),
        ],
    );
    let m = medium(
        5,
        &[
            ("m1", "Eagle", Some(349)),
            ("m2", "I’m a Marionette", Some(249)),
            ("m3", "Thank You for the Music", Some(229)),
        ],
    );
    let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
        .expect("six seconds is drift, not a different track")
        .into_iter()
        .collect();
    assert_eq!(by_local["l2"], "m2");
}

/// The bound still has to mean something: a shared title with a wildly different runtime is a
/// different recording, not a different rip.
#[test]
fn a_wildly_different_runtime_is_still_a_different_track() {
    let local = sibling(
        "a",
        "f",
        &[("l1", "One", Some(100)), ("l2", "Jam", Some(120))],
    );
    let m = medium(1, &[("m1", "One", Some(100)), ("m2", "Jam", Some(600))]);
    assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
}

/// A loose match that fits two remaining tracks equally is refused, not guessed at.
#[test]
fn an_ambiguous_loose_match_is_refused() {
    let local = sibling(
        "cd1",
        "Box/CD 1",
        &[("l1", "Ring Ring", Some(185)), ("l2", "Filler", Some(100))],
    );
    let m = medium(
        1,
        &[
            ("m1", "Ring Ring (English version)", Some(184)),
            ("m2", "Ring Ring (Spanish version)", Some(186)),
        ],
    );
    assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
}

#[test]
fn a_differing_tracklist_still_fails_to_pair() {
    let local = sibling(
        "a",
        "f",
        &[("l1", "One", Some(100)), ("l2", "Two", Some(100))],
    );
    let wrong_title = medium(1, &[("m1", "One", Some(100)), ("m2", "Three", Some(100))]);
    let wrong_len = medium(1, &[("m1", "One", Some(100))]);
    let wrong_dur = medium(1, &[("m1", "One", Some(100)), ("m2", "Two", Some(400))]);
    assert!(pair_tracks(&local.tracks, &wrong_title.tracks).is_none());
    assert!(pair_tracks(&local.tracks, &wrong_len.tracks).is_none());
    assert!(pair_tracks(&local.tracks, &wrong_dur.tracks).is_none());
}

#[test]
fn repeated_titles_each_claim_a_distinct_medium_track() {
    let local = sibling(
        "a",
        "f",
        &[("l1", "Intro", Some(60)), ("l2", "Intro", Some(60))],
    );
    let m = medium(1, &[("m1", "Intro", Some(60)), ("m2", "Intro", Some(60))]);
    let links = pair_tracks(&local.tracks, &m.tracks).unwrap();
    assert_eq!(links.len(), 2);
    assert_ne!(
        links[0].1, links[1].1,
        "one medium track cannot serve two local tracks"
    );
}

// -----------------------------------------------------------------------
// Ladder passes 1c / 2 / 3 / 4 (docs/specs/spec_tidy_observations.md round 2)
// -----------------------------------------------------------------------

/// Pass 2's window used to be 5s while pass 1b already allowed 15s, so a containment pair with a
/// few seconds of drift was refused although the identical-title pair beside it was accepted.
/// Real case: Bass Mekanik's "Reload" disc 2, "20Hz Sine Wave" against MusicBrainz's "20Hz".
#[test]
fn a_contained_title_tolerates_the_same_drift_an_exact_one_does() {
    let local = sibling(
        "cd2",
        "Box/CD 2",
        &[
            ("l1", "20Hz Sine Wave", Some(129)),
            ("l2", "Bass Mekanik", Some(200)),
        ],
    );
    let m = medium(
        2,
        &[("m1", "20Hz", Some(120)), ("m2", "Bass Mekanik", Some(200))],
    );
    let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
        .expect("nine seconds is drift, not a different track")
        .into_iter()
        .collect();
    assert_eq!(by_local["l1"], "m1");
}

/// Marillion's "The Singles '82-88' (Boxset)" disc 4. Both sides carry a *different* qualifier, so
/// containment cannot see it - neither string contains the other - yet the runtimes agree to the
/// second. One track out of 44 cost the whole twelve-disc box its placement.
#[test]
fn two_differently_qualified_titles_pair_on_their_base_title() {
    let local = sibling(
        "cd4",
        "Box/CD 4",
        &[
            ("l1", "Punch and Judy", Some(200)),
            ("l2", "Market Square Heroes (re-record edit)", Some(240)),
            (
                "l3",
                "Three Boats Down From the Candy (re-record)",
                Some(242),
            ),
            (
                "l4",
                "Market Square Heroes (alternative version)",
                Some(288),
            ),
        ],
    );
    let m = medium(
        4,
        &[
            ("m1", "Punch and Judy", Some(200)),
            ("m2", "Market Square Heroes (re-record edit)", Some(240)),
            (
                "m3",
                "Three Boats Down From the Candy (re-record)",
                Some(242),
            ),
            ("m4", "Market Square Heroes (re-record)", Some(288)),
        ],
    );
    let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
        .expect("a differing qualifier must not reject the disc")
        .into_iter()
        .collect();
    assert_eq!(by_local["l4"], "m4");
    assert_eq!(
        by_local["l2"], "m2",
        "the exact pair is still claimed first"
    );
}

/// The hazard pass 3's uniqueness test exists for: a base title shared by several qualified
/// variants (ABBA's four language versions of "Ring Ring") must refuse, not pick one.
#[test]
fn a_base_title_matching_two_variants_is_refused() {
    let local = sibling(
        "cd1",
        "Box/CD 1",
        &[
            ("l1", "Ring Ring (German version)", Some(185)),
            ("l2", "Santa Rosa", Some(181)),
        ],
    );
    let m = medium(
        1,
        &[
            ("m1", "Ring Ring (English version)", Some(184)),
            ("m2", "Santa Rosa", Some(181)),
        ],
    );
    // Only one variant remains, so this one *does* pair - the refusal case needs two.
    assert!(pair_tracks(&local.tracks, &m.tracks).is_some());

    let m_two = medium(
        1,
        &[
            ("m1", "Ring Ring (English version)", Some(184)),
            ("m2", "Ring Ring (Spanish version)", Some(186)),
        ],
    );
    let local_two = sibling(
        "cd1",
        "Box/CD 1",
        &[
            ("l1", "Ring Ring (German version)", Some(185)),
            ("l2", "Ring Ring (Swedish version)", Some(185)),
        ],
    );
    assert!(
        pair_tracks(&local_two.tracks, &m_two.tracks).is_none(),
        "two variants of one base title are ambiguous, not a pairing"
    );
}

/// Pass 4: a one-character tagging typo on a disc that otherwise lines up exactly. Art Tatum's
/// "Piano Grand Master" disc 2 - "Sweet Emalina My Gal" against "Sweet Emaline My Gal".
#[test]
fn a_single_character_typo_still_pairs() {
    let local = sibling(
        "d2",
        "Box/Disc 2",
        &[
            ("l1", "Elegie", Some(200)),
            ("l2", "Sweet Emalina My Gal", Some(180)),
        ],
    );
    let m = medium(
        2,
        &[
            ("m1", "Elegie", Some(200)),
            ("m2", "Sweet Emaline My Gal", Some(182)),
        ],
    );
    let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
        .expect("one letter is a typo, not a different song")
        .into_iter()
        .collect();
    assert_eq!(by_local["l2"], "m2");
}

/// The other side of pass 4: a mondegreen is a *different song*, and must stay refused however
/// much of the string it shares. Belinda Carlisle's "The Anthology" disc 2.
#[test]
fn a_differently_worded_title_is_not_a_typo() {
    let local = sibling(
        "cd2",
        "Box/CD 2",
        &[
            ("l1", "Heaven Is a Place on Earth", Some(240)),
            ("l2", "Bless Yourself and the Children", Some(200)),
        ],
    );
    let m = medium(
        2,
        &[
            ("m1", "Heaven Is a Place on Earth", Some(240)),
            ("m2", "Bless the Beasts and the Children", Some(200)),
        ],
    );
    assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
}

/// Pass 4 is the weakest rule on the ladder, so it demands both runtimes actually be known -
/// unlike every pass above it, where an unknown duration is merely missing evidence.
#[test]
fn a_typo_without_durations_is_refused() {
    let local = sibling(
        "d2",
        "Box/Disc 2",
        &[("l1", "Elegie", None), ("l2", "Sweet Emalina My Gal", None)],
    );
    let m = medium(
        2,
        &[("m1", "Elegie", None), ("m2", "Sweet Emaline My Gal", None)],
    );
    assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
}

/// Pass 1c: three tracks pair exactly, so the disc has already vouched for itself, and the lone
/// same-titled outlier a minute out is a different master rather than a different disc.
#[test]
fn a_corroborated_disc_absorbs_one_long_runtime_outlier() {
    let local = sibling(
        "cd2",
        "Box/CD 2",
        &[
            ("l1", "One", Some(100)),
            ("l2", "Two", Some(100)),
            ("l3", "Three", Some(100)),
            ("l4", "Jam", Some(300)),
        ],
    );
    let m = medium(
        2,
        &[
            ("m1", "One", Some(100)),
            ("m2", "Two", Some(100)),
            ("m3", "Three", Some(100)),
            ("m4", "Jam", Some(340)),
        ],
    );
    let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
        .expect("three exact pairs vouch for the fourth")
        .into_iter()
        .collect();
    assert_eq!(by_local["l4"], "m4");
}

/// ...and without that corroboration the same outlier still rejects the disc. This is what keeps
/// the 60s window from being the flat loosening docs/sync_decisions.md §9 argues against.
#[test]
fn an_uncorroborated_runtime_outlier_still_rejects_the_disc() {
    let local = sibling(
        "cd2",
        "Box/CD 2",
        &[("l1", "One", Some(100)), ("l2", "Jam", Some(300))],
    );
    let m = medium(2, &[("m1", "One", Some(100)), ("m2", "Jam", Some(340))]);
    assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
}

// -----------------------------------------------------------------------
// Tier (d): rebuilding a candidate from stored rows (docs/sync_decisions.md §19 item 3)
// -----------------------------------------------------------------------

fn stored_track(
    disc: i32,
    mb_id: Option<&str>,
    title: &str,
    ms: Option<i32>,
) -> (Option<i32>, Option<String>, String, Option<i32>) {
    (Some(disc), mb_id.map(str::to_string), title.to_string(), ms)
}

#[test]
fn a_fully_stored_box_rebuilds_without_touching_musicbrainz() {
    let media = [(1, 2), (2, 1)];
    let tracks = [
        stored_track(1, Some("mb-1"), "A", Some(100_000)),
        stored_track(1, Some("mb-2"), "B", Some(200_000)),
        stored_track(2, Some("mb-3"), "C", Some(300_000)),
    ];
    let candidate = box_candidate_from_rows("box-mbid", &media, &tracks).expect("rebuilds");
    assert_eq!(candidate.release_id, "box-mbid");
    assert_eq!(candidate.media.len(), 2);
    assert_eq!(candidate.media[0].tracks.len(), 2);
    // Durations come back in seconds, as `build_candidate` produces them from the API.
    assert_eq!(candidate.media[0].tracks[0].2, Some(100));
}

/// Each rejection sends the caller back to the network - that is what keeps tier (d) an
/// optimisation rather than a second, weaker source of truth.
#[test]
fn incomplete_stored_rows_fall_back_to_the_network() {
    let full = [
        stored_track(1, Some("mb-1"), "A", Some(100_000)),
        stored_track(2, Some("mb-2"), "B", Some(200_000)),
    ];
    // Single medium: not a box.
    assert!(box_candidate_from_rows("b", &[(1, 1)], &full[..1]).is_none());
    // A medium with no track rows at all.
    assert!(box_candidate_from_rows("b", &[(1, 1), (2, 1), (3, 1)], &full).is_none());
    // Row count disagrees with the recorded trackCount - a half-synced release.
    assert!(box_candidate_from_rows("b", &[(1, 2), (2, 1)], &full).is_none());
    // A track with no MusicBrainz id: nothing to link a local track against.
    let no_id = [
        stored_track(1, None, "A", Some(100_000)),
        stored_track(2, Some("mb-2"), "B", Some(200_000)),
    ];
    assert!(box_candidate_from_rows("b", &[(1, 1), (2, 1)], &no_id).is_none());
}

// -----------------------------------------------------------------------
// Nested groups: root folder + subfolders (docs/specs/spec_tidy_observations.md §15)
// -----------------------------------------------------------------------

fn row(id: &str, path: &str) -> SiblingRow {
    SiblingRow {
        local_id: id.to_string(),
        folder_path: path.to_string(),
        unanimous_mb_release_id: None,
        placed: false,
    }
}

fn nested(root: &str, rows: Vec<SiblingRow>) -> SiblingGroup {
    SiblingGroup {
        parent: root.to_string(),
        rows,
        nested: true,
    }
}

/// Clutch's "Blast Tyrant": CD 1 in the album folder itself, CD 2 in a subfolder. The fold path is
/// the common ancestor of every member - here the root folder, which is itself a member. That is
/// what keeps `apply_fold` from treating it as a foreign release holding the key (it only refuses
/// when the key belongs to a release *outside* the plan).
#[test]
fn a_nested_group_folds_onto_its_own_root_folder() {
    let siblings = vec![
        sibling(
            "root",
            "Clutch/Album/2004 - Blast Tyrant",
            &[
                ("t1", "Mercury", Some(60)),
                ("t2", "Profits of Doom", Some(250)),
            ],
        ),
        sibling(
            "cd2",
            "Clutch/Album/2004 - Blast Tyrant/CD 2 - Bonus Disc",
            &[
                ("t3", "Drink to the Dead", Some(200)),
                ("t4", "Cypress Grove", Some(210)),
            ],
        ),
    ];
    let candidate = BoxCandidate {
        release_id: "mb".to_string(),
        media: vec![
            medium(
                1,
                &[
                    ("m1", "Mercury", Some(60)),
                    ("m2", "Profits of Doom", Some(250)),
                ],
            ),
            medium(
                2,
                &[
                    ("m3", "Drink to the Dead", Some(200)),
                    ("m4", "Cypress Grove", Some(210)),
                ],
            ),
        ],
    };
    let plan = plan_box_bind(&siblings, &candidate).expect("binds");
    assert_eq!(plan.folder_path, "Clutch/Album/2004 - Blast Tyrant");
    assert_eq!(plan.survivor, "root", "disc 1 - the root folder - survives");
    assert_eq!(plan.absorbed, vec!["cd2".to_string()]);
}

#[test]
fn nested_groups_never_overlap_sibling_groups_or_each_other() {
    let already: HashSet<String> = ["sib".to_string()].into_iter().collect();
    let groups = keep_disjoint_groups(
        vec![
            // Outer root first (shortest path), claims its whole tree.
            nested(
                "A",
                vec![row("a", "A"), row("ab", "A/B"), row("abc", "A/B/C")],
            ),
            // A sub-root inside it: overlaps, dropped.
            nested("A/B", vec![row("ab", "A/B"), row("abc", "A/B/C")]),
            // Shares a folder with a sibling group: the box pass keeps it, dropped here.
            nested("X", vec![row("x", "X"), row("sib", "X/CD 2")]),
            // A lone folder is nothing to fold.
            nested("Y", vec![row("y", "Y")]),
            nested("Z", vec![row("z", "Z"), row("z2", "Z/CD 2")]),
        ],
        &already,
    );
    let roots: Vec<&str> = groups.iter().map(|g| g.parent.as_str()).collect();
    assert_eq!(roots, vec!["A", "Z"]);
}

#[test]
fn strip_qualifier_drops_trailing_bracket_groups_only() {
    assert_eq!(
        strip_qualifier("Market Square Heroes (re-record)"),
        "Market Square Heroes"
    );
    assert_eq!(strip_qualifier("Song (live) [remastered]"), "Song");
    assert_eq!(strip_qualifier("Plain Title"), "Plain Title");
    // A bracket that is not trailing is part of the title.
    assert_eq!(
        strip_qualifier("(I Can't Get No) Satisfaction"),
        "(I Can't Get No) Satisfaction"
    );
    // Nothing but a qualifier leaves no base title to compare.
    assert_eq!(strip_qualifier("(Untitled)"), "");
}

/// Differential harness: replays `plan_box_bind_detailed` over a dump of every sibling-folder
/// group in a real library and prints how many bind. Not a unit test - it needs two dump files -
/// so it is `#[ignore]`d and run by hand:
///
/// ```text
/// BOX_DUMP_LOCAL=/path/all_local.txt BOX_DUMP_MB=/path/all_mb.txt \
///   cargo test -p sync replay_library_dump -- --ignored --nocapture
/// ```
///
/// Exists because unit tests cannot answer the only question that matters when the matcher
/// changes: *did anything that used to bind stop binding*. The dump format is one
/// `L|parent|folder|trackId|title|seconds` line per local track and one
/// `M|parent|discNumber|trackId|title|seconds` line per MusicBrainz track.
#[test]
#[ignore]
fn replay_library_dump() {
    use std::collections::BTreeMap;
    let (Ok(local_path), Ok(mb_path)) = (
        std::env::var("BOX_DUMP_LOCAL"),
        std::env::var("BOX_DUMP_MB"),
    ) else {
        eprintln!("set BOX_DUMP_LOCAL and BOX_DUMP_MB");
        return;
    };

    type Tracks = Vec<(String, String, Option<i32>)>;
    let mut locals: BTreeMap<String, BTreeMap<String, Tracks>> = BTreeMap::new();
    for line in std::fs::read_to_string(&local_path).unwrap().lines() {
        let f: Vec<&str> = line.splitn(6, '|').collect();
        if f.len() < 6 || f[0] != "L" {
            continue;
        }
        locals
            .entry(f[1].to_string())
            .or_default()
            .entry(f[2].to_string())
            .or_default()
            .push((f[3].to_string(), f[4].to_string(), f[5].parse().ok()));
    }
    let mut media: BTreeMap<String, BTreeMap<i32, Tracks>> = BTreeMap::new();
    for line in std::fs::read_to_string(&mb_path).unwrap().lines() {
        let f: Vec<&str> = line.splitn(6, '|').collect();
        if f.len() < 6 || f[0] != "M" {
            continue;
        }
        let Ok(disc) = f[2].parse::<i32>() else {
            continue;
        };
        media
            .entry(f[1].to_string())
            .or_default()
            .entry(disc)
            .or_default()
            .push((f[3].to_string(), f[4].to_string(), f[5].parse().ok()));
    }

    let (mut bound, mut refused, mut partial) = (0usize, 0usize, 0usize);
    for (parent, folders) in &locals {
        let Some(discs) = media.get(parent) else {
            continue;
        };
        if discs.len() < 2 || folders.len() < 2 {
            continue;
        }
        let siblings: Vec<BoxSibling> = folders
            .iter()
            .map(|(path, tracks)| BoxSibling {
                local_id: path.clone(),
                folder_path: path.clone(),
                tracks: tracks.clone(),
            })
            .collect();
        let candidate = BoxCandidate {
            release_id: parent.clone(),
            media: discs
                .iter()
                .map(|(position, tracks)| BoxMedium {
                    position: *position,
                    tracks: tracks.clone(),
                })
                .collect(),
        };
        match plan_box_bind_detailed(&siblings, &candidate) {
            Ok(plan) => {
                bound += 1;
                if plan.members.len() < siblings.len() {
                    partial += 1;
                }
            }
            Err(_) => refused += 1,
        }
    }
    let line = format!(
        "replay: {} groups, {} bind ({} of them partial), {} refuse",
        bound + refused,
        bound,
        partial,
        refused
    );
    println!("{line}");
    // Also to a file: a test runner (or a wrapper around cargo) that captures stdout would
    // otherwise swallow the only output this harness exists to produce.
    if let Ok(out) = std::env::var("BOX_DUMP_OUT") {
        std::fs::write(out, format!("{line}\n")).ok();
    }
}

fn sibling(id: &str, folder: &str, tracks: &[(&str, &str, Option<i32>)]) -> BoxSibling {
    BoxSibling {
        local_id: id.to_string(),
        folder_path: folder.to_string(),
        tracks: tracks
            .iter()
            .map(|(tid, title, secs)| (tid.to_string(), title.to_string(), *secs))
            .collect(),
    }
}

fn medium(position: i32, tracks: &[(&str, &str, Option<i32>)]) -> BoxMedium {
    BoxMedium {
        position,
        tracks: tracks
            .iter()
            .map(|(tid, title, secs)| (tid.to_string(), title.to_string(), *secs))
            .collect(),
    }
}

#[test]
fn shape_a_binds_a_disc_mis_tagged_as_the_standalone_album() {
    // CD1 is tagged as the standalone "Ring Ring" release, CD2 as the box - tier 1 leaves both
    // behind since they don't share an embedded release id. Tier 2 matches by tracklist alone.
    let siblings = vec![
        sibling(
            "cd1",
            "ABBA/Box/CD 1-1973 - Ring Ring",
            &[
                ("t1", "Ring Ring", Some(186)),
                ("t2", "Another Town, Another Train", Some(193)),
            ],
        ),
        sibling(
            "cd2",
            "ABBA/Box/CD 2-1974 - Waterloo",
            &[("t3", "Waterloo", Some(180))],
        ),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(
                1,
                &[
                    ("mb-t1", "Ring Ring", Some(185)),
                    ("mb-t2", "Another Town, Another Train", Some(192)),
                ],
            ),
            medium(2, &[("mb-t3", "Waterloo", Some(179))]),
        ],
    };

    let plan = plan_box_bind(&siblings, &candidate).expect("binds");
    assert_eq!(plan.release_id, "mb-box");
    assert_eq!(plan.survivor, "cd1");
    assert_eq!(plan.absorbed, vec!["cd2".to_string()]);
    assert_eq!(plan.folder_path, "ABBA/Box");
    assert_eq!(plan.members.len(), 2);
    assert_eq!(
        plan.track_links,
        vec![
            ("t1".to_string(), "mb-t1".to_string()),
            ("t2".to_string(), "mb-t2".to_string()),
            ("t3".to_string(), "mb-t3".to_string()),
        ]
    );
}

#[test]
fn shape_b_binds_discs_each_tagged_as_their_own_standalone_album() {
    // Neither sibling's embedded id points at the box at all - every disc was tagged as its own
    // album. Nothing here differs mechanically from shape (a): tier 2 never looks at tags.
    let siblings = vec![
        sibling(
            "ringring",
            "ABBA/Box/1973 - Ring Ring",
            &[("t1", "Ring Ring", Some(186))],
        ),
        sibling(
            "waterloo",
            "ABBA/Box/1974 - Waterloo",
            &[("t2", "Waterloo", Some(180))],
        ),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "Ring Ring", Some(185))]),
            medium(2, &[("mb-t2", "Waterloo", Some(179))]),
            medium(3, &[("mb-t3", "Bonus Tracks", Some(200))]),
        ],
    };

    let plan = plan_box_bind(&siblings, &candidate).expect("binds");
    assert_eq!(
        plan.members.len(),
        2,
        "only the two ripped discs, the third is simply not owned"
    );
}

#[test]
fn a_partially_ripped_box_is_allowed() {
    let siblings = vec![
        sibling("cd1", "Box/CD1", &[("t1", "A", Some(100))]),
        sibling("cd3", "Box/CD3", &[("t3", "C", Some(100))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "A", Some(100))]),
            medium(2, &[("mb-t2", "B", Some(100))]),
            medium(3, &[("mb-t3", "C", Some(100))]),
        ],
    };

    let plan = plan_box_bind(&siblings, &candidate).expect("binds");
    assert_eq!(plan.members.len(), 2);
}

#[test]
fn refuses_when_two_siblings_claim_the_same_medium() {
    // Duplicate rips of the same disc, not two halves of a box - reject rather than guess which
    // copy is canonical (mirrors multi_disc::plan_group's contested-disc rule).
    let siblings = vec![
        sibling("a", "Box/CD1 [FLAC]", &[("t1", "A", Some(100))]),
        sibling("b", "Box/CD1 [MP3]", &[("t2", "A", Some(100))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![medium(1, &[("mb-t1", "A", Some(100))])],
    };

    assert!(plan_box_bind(&siblings, &candidate).is_none());
}

#[test]
fn refuses_when_a_sibling_matches_no_medium() {
    // Wrong candidate entirely: track counts/titles don't line up with any medium.
    let siblings = vec![
        sibling("a", "Box/CD1", &[("t1", "A", Some(100))]),
        sibling("b", "Box/CD2", &[("t2", "Totally Different", Some(999))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "A", Some(100))]),
            medium(2, &[("mb-t2", "B", Some(100))]),
        ],
    };

    assert!(plan_box_bind(&siblings, &candidate).is_none());
}

/// Rome's "Hall Of Thatch [Vinyl Rip]". The box holds two masterings of the same album, so once
/// the 60s corroborated window opens the folder pairs with *both* - while under the tight rules it
/// pairs with exactly one. The strict answer has to win, or widening a rule would turn a settled
/// bind into an ambiguity and the whole group would stop binding.
#[test]
fn a_folder_keeps_the_disc_the_strict_rules_gave_it() {
    let siblings = vec![
        sibling(
            "cd1",
            "Box/CD 1",
            &[
                ("l1", "A", Some(100)),
                ("l2", "B", Some(100)),
                ("l3", "C", Some(100)),
                ("l4", "D", Some(200)),
            ],
        ),
        sibling("cd2", "Box/CD 2", &[("l5", "Z", Some(100))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            // The remaster: same four titles, one of them 40s out - only reachable at depth >= 1.
            medium(
                1,
                &[
                    ("m1", "A", Some(100)),
                    ("m2", "B", Some(100)),
                    ("m3", "C", Some(100)),
                    ("m4", "D", Some(240)),
                ],
            ),
            // The original: an exact match at depth 0.
            medium(
                2,
                &[
                    ("n1", "A", Some(100)),
                    ("n2", "B", Some(100)),
                    ("n3", "C", Some(100)),
                    ("n4", "D", Some(200)),
                ],
            ),
            medium(3, &[("o1", "Z", Some(100))]),
        ],
    };

    // Both discs pair at the loosest level...
    assert!(pair_tracks(&siblings[0].tracks, &candidate.media[0].tracks).is_some());
    assert!(pair_tracks(&siblings[0].tracks, &candidate.media[1].tracks).is_some());
    // ...but only the exact one pairs at depth 0, and that is the one the plan must use.
    assert!(pair_tracks_at(&siblings[0].tracks, &candidate.media[0].tracks, 0).is_none());
    assert!(pair_tracks_at(&siblings[0].tracks, &candidate.media[1].tracks, 0).is_some());

    let plan = plan_box_bind(&siblings, &candidate).expect("the strict answer resolves it");
    let by_local: std::collections::HashMap<_, _> = plan.members.into_iter().collect();
    assert_eq!(
        by_local["cd1"], 2,
        "the exact mastering, not the 40s-out one"
    );
}

/// docs/sync_decisions.md §19 item 1b. A box whose rip carries one folder that is on no disc of
/// any edition - a bonus DVD-audio, an SACD layer beside the CD rip - used to reject the whole
/// group. The extra folder is now simply left out; nothing about its row changes.
#[test]
fn a_sibling_on_no_disc_is_left_out_instead_of_refusing_the_box() {
    let siblings = vec![
        sibling("cd1", "Box/CD1", &[("t1", "A", Some(100))]),
        sibling("cd2", "Box/CD2", &[("t2", "B", Some(100))]),
        sibling("dvd", "Box/DVD-Audio", &[("t3", "Bonus Film", Some(999))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "A", Some(100))]),
            medium(2, &[("mb-t2", "B", Some(100))]),
        ],
    };

    let plan = plan_box_bind(&siblings, &candidate).expect("two matched siblings are enough");
    assert_eq!(plan.members.len(), 2);
    let bound: Vec<&str> = plan.members.iter().map(|(id, _)| id.as_str()).collect();
    assert!(
        !bound.contains(&"dvd"),
        "the unmatched folder must not be bound"
    );
    assert!(
        !plan.absorbed.contains(&"dvd".to_string()),
        "and must never be absorbed - apply_fold deletes what it absorbs"
    );
    assert_eq!(
        plan.folder_path, "Box",
        "the box root still spans every sibling, matched or not"
    );
}

/// A partial bind needs a majority, not just two. Binding 2 of 6 folders would fold those two into
/// one release and leave four loose - worse on screen than leaving the group alone.
#[test]
fn a_partial_bind_below_half_the_folders_is_refused() {
    let mut siblings = vec![
        sibling("cd1", "Box/CD1", &[("t1", "A", Some(100))]),
        sibling("cd2", "Box/CD2", &[("t2", "B", Some(100))]),
    ];
    for n in 3..=6 {
        siblings.push(sibling(
            &format!("x{n}"),
            &format!("Box/Extra{n}"),
            &[(&format!("u{n}"), "Unrelated", Some(999))],
        ));
    }
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "A", Some(100))]),
            medium(2, &[("mb-t2", "B", Some(100))]),
        ],
    };
    assert!(matches!(
        plan_box_bind_detailed(&siblings, &candidate),
        Err(BindRefusal::TooFewMatched { matched: 2 })
    ));

    // Exactly half still binds - the rule is "not a minority", not "a strict majority".
    let half = &siblings[..4];
    assert!(plan_box_bind(half, &candidate).is_some());
}

/// The distinction that keeps the partial bind safe: "on no disc" is evidence about one folder,
/// "could be either disc" is evidence the candidate itself is wrong.
#[test]
fn an_ambiguous_sibling_still_refuses_the_whole_group() {
    let siblings = vec![
        sibling("cd1", "Box/CD1", &[("t1", "A", Some(100))]),
        sibling("cd2", "Box/CD2", &[("t2", "B", Some(100))]),
        sibling("cd3", "Box/CD3", &[("t3", "A", Some(100))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![
            medium(1, &[("mb-t1", "A", Some(100))]),
            medium(2, &[("mb-t2", "B", Some(100))]),
            medium(3, &[("mb-t3", "A", Some(100))]),
        ],
    };
    assert!(matches!(
        plan_box_bind_detailed(&siblings, &candidate),
        Err(BindRefusal::Ambiguous { .. })
    ));
}

#[test]
fn a_refusal_names_its_reason() {
    let siblings = vec![
        sibling("a", "Box/CD1 [FLAC]", &[("t1", "A", Some(100))]),
        sibling("b", "Box/CD1 [MP3]", &[("t2", "A", Some(100))]),
    ];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![medium(1, &[("mb-t1", "A", Some(100))])],
    };
    let refusal = plan_box_bind_detailed(&siblings, &candidate).unwrap_err();
    assert_eq!(refusal.kind(), "collision");
    assert!(refusal.describe("The Box").contains("disc 1"));
}

#[test]
fn a_single_sibling_is_never_a_bind() {
    let siblings = vec![sibling("a", "Box/CD1", &[("t1", "A", Some(100))])];
    let candidate = BoxCandidate {
        release_id: "mb-box".to_string(),
        media: vec![medium(1, &[("mb-t1", "A", Some(100))])],
    };
    assert!(plan_box_bind(&siblings, &candidate).is_none());
}

#[test]
fn guesses_a_search_title_from_the_parent_folder() {
    assert_eq!(
        guess_box_title("ABBA/Compilation/2008 - The Albums (9CD)"),
        "The Albums"
    );
    assert_eq!(
        guess_box_title("ABBA/Compilation/2005 - The Complete Studio Recordings (9CD)"),
        "The Complete Studio Recordings"
    );
    assert_eq!(
        guess_box_title("ABBA/Compilation/No Year Box (3CD)"),
        "No Year Box"
    );
}

/// A catalogue number in brackets used to search MusicBrainz for a title it never returned a hit
/// for - HIM's "The Single Collection" sat undiscoverable via tier (b) because of this.
#[test]
fn guess_box_title_strips_bracketed_catalogue_numbers_too() {
    assert_eq!(
        guess_box_title("HIM/Album/2002 - The Single Collection [#74321 96173 2]"),
        "The Single Collection"
    );
    assert_eq!(
        guess_box_title("IQ/Remastered/1985 - The Wake (3 CD) [GEPBOX2]"),
        "The Wake"
    );
    // Whichever bracket opens first wins, regardless of order.
    assert_eq!(guess_box_title("X/2020 - Title [CAT001] (Deluxe)"), "Title");
}

/// HIM's real "The Single Collection" (10 CDs, 44 tracks, curly-vs-straight apostrophes, one
/// medium with a 1-second duration drift) - the case that motivated the 2026-09-11 box-set fix.
/// Every disc must resolve to its own, distinct medium.
#[test]
fn hims_ten_disc_box_binds_every_medium() {
    // (disc position, [(title, local secs, mb secs)])
    type DiscFixture<'a> = (i32, &'a [(&'a str, i32, i32)]);
    let discs: &[DiscFixture] = &[
        (
            1,
            &[
                ("It's All Tears (Drown in This Love)", 225, 224),
                ("The Heartless (club remix)", 238, 238),
            ],
        ),
        (
            2,
            &[
                ("Wicked Game", 234, 234),
                ("For You", 240, 240),
                ("Our Diabolikal Rapture", 321, 321),
                ("Wicked Game (666 remix)", 234, 234),
            ],
        ),
        (
            3,
            &[
                ("When Love and Death Embrace (radio edit)", 216, 216),
                ("When Love and Death Embrace (AOR radio mix)", 219, 219),
                (
                    "When Love and Death Embrace (original single edit)",
                    257,
                    257,
                ),
                ("When Love and Death Embrace (album version)", 368, 368),
            ],
        ),
        (
            4,
            &[
                ("Join Me", 221, 221),
                ("It's All Tears (Unplugged version) (live)", 230, 230),
                ("Rebel Yell (live)", 313, 313),
                ("Dark Sekret Love", 316, 316),
            ],
        ),
        (
            5,
            &[
                ("Right Here in My Arms (radio edit)", 205, 205),
                ("Join Me in Death (Razorblade mix)", 217, 217),
                ("The Heartless (Space Jazz Dubmen mix)", 239, 239),
                ("I've Crossed Oceans of Wine to Find You", 280, 280),
            ],
        ),
        (
            6,
            &[
                ("Poison Girl", 232, 232),
                ("Right Here in My Arms (live)", 283, 283),
                ("It's All Tears (live)", 235, 235),
                ("Poison Girl (live)", 218, 218),
            ],
        ),
        (
            7,
            &[
                ("Gone With the Sin (radio edit)", 234, 234),
                ("Gone With the Sin (O.D. version)", 299, 299),
                ("For You (acoustic version)", 249, 249),
                ("Bury Me Deep Inside Your Heart (live)", 252, 252),
                ("Gone With the Sin (album version)", 262, 262),
            ],
        ),
        (
            8,
            &[
                ("Pretending", 224, 224),
                ("Pretending (alternative mix)", 239, 239),
                ("Pretending (The Cosmic Pope Jam version)", 482, 482),
                ("Please Don't Let It Go (acoustic version)", 281, 281),
                // Real drift observed on disc: 1 second, well within the ±5s tie-breaker.
                ("Lose You Tonight (Caravan version)", 368, 367),
            ],
        ),
        (
            9,
            &[
                ("In Joy and Sorrow (radio edit)", 215, 215),
                ("Again", 212, 212),
                ("In Joy and Sorrow (string version)", 305, 305),
                ("Salt in Our Wounds (Thulsa Doom version)", 424, 424),
                ("Beautiful (Third Seal)", 286, 286),
            ],
        ),
        (
            10,
            &[
                ("Heartache Every Moment", 238, 238),
                ("Close to the Flame", 230, 230),
                ("Salt in Our Wounds (acoustic)", 243, 243),
                ("In Joy and Sorrow (acoustic)", 242, 242),
                ("Pretending (acoustic)", 242, 242),
                ("Heartache Every Moment (acoustic)", 215, 215),
                ("Close to the Flame (acoustic)", 201, 201),
            ],
        ),
    ];

    let mut siblings = Vec::new();
    let mut media = Vec::new();
    let mut expected_track_count = 0usize;
    for (position, tracks) in discs {
        let local_tracks: Vec<(String, String, Option<i32>)> = tracks
            .iter()
            .enumerate()
            .map(|(i, (title, local_secs, _))| {
                (
                    format!("cd{position}-t{i}"),
                    title.to_string(),
                    Some(*local_secs),
                )
            })
            .collect();
        let mb_tracks: Vec<(String, String, Option<i32>)> = tracks
            .iter()
            .enumerate()
            .map(|(i, (title, _, mb_secs))| {
                (
                    format!("mb-cd{position}-t{i}"),
                    title.to_string(),
                    Some(*mb_secs),
                )
            })
            .collect();
        expected_track_count += local_tracks.len();
        siblings.push(sibling(
            &format!("cd{position}"),
            &format!("HIM/Album/2002 - The Single Collection [#74321 96173 2]/CD {position}"),
            &local_tracks
                .iter()
                .map(|(id, t, s)| (id.as_str(), t.as_str(), *s))
                .collect::<Vec<_>>(),
        ));
        media.push(medium(
            *position,
            &mb_tracks
                .iter()
                .map(|(id, t, s)| (id.as_str(), t.as_str(), *s))
                .collect::<Vec<_>>(),
        ));
    }
    let candidate = BoxCandidate {
        release_id: "b6bb7356-5084-4285-977b-e02ec996ca88".to_string(),
        media,
    };

    let plan = plan_box_bind(&siblings, &candidate).expect("the real HIM box must bind");
    assert_eq!(
        plan.members.len(),
        10,
        "every disc must resolve to its own medium"
    );
    assert_eq!(plan.track_links.len(), expected_track_count);
    let mut positions: Vec<i32> = plan.members.iter().map(|(_, p)| *p).collect();
    positions.sort_unstable();
    assert_eq!(positions, (1..=10).collect::<Vec<_>>());
}

// -----------------------------------------------------------------------
// Fold vs dissolve (docs/sync_decisions.md)
// -----------------------------------------------------------------------

#[test]
fn folds_at_zero_equivalents() {
    assert!(matches!(decide_outcome(0), BoxOutcome::Fold));
}

#[test]
fn folds_at_exactly_one_equivalent() {
    // The E-special-edition case: a lone equivalent medium is deliberately not enough to
    // dissolve a genuine multi-disc release over one coincidental link.
    assert!(matches!(decide_outcome(1), BoxOutcome::Fold));
}

#[test]
fn dissolves_at_two_equivalents() {
    assert!(matches!(decide_outcome(2), BoxOutcome::Dissolve));
}

#[test]
fn dissolves_at_two_equivalents_regardless_of_total_medium_count() {
    // A 9-medium box with only 2 confirmed equivalents still dissolves - folding it would hide
    // 2 known editions to avoid showing 7 unrecognised discs, which is strictly worse.
    assert!(matches!(decide_outcome(2), BoxOutcome::Dissolve));
    assert!(matches!(decide_outcome(9), BoxOutcome::Dissolve));
}
