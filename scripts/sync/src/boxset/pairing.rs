use std::collections::HashMap;

use crate::owned::{durations_compatible, durations_within, normalize_title};
use crate::title_rules::{strip_qualifier, titles_near_identical};

// ---------------------------------------------------------------------------
// Pure decision logic - no network, no DB. See `plan_box_bind`.
// ---------------------------------------------------------------------------

/// One sibling folder tier 1 left unmerged, with its own local tracklist in track order.
/// `(LocalReleaseTrack.id, title, duration secs)` - order matters, since a medium's tracks are
/// compared positionally, not by fuzzy title search (unlike `owned::find_owning_bundle`, which
/// searches because a bonus disc's tracks are scattered inside a bigger folder; here each candidate
/// medium is already exactly one folder's worth of tracks, so position order is meaningful and a
/// content match is much stronger evidence than an unordered one).
#[derive(Debug, Clone)]
pub struct BoxSibling {
    pub local_id: String,
    pub folder_path: String,
    pub tracks: Vec<(String, String, Option<i32>)>,
}

/// One medium of a candidate MB release, tracklist in position order.
/// `(MB track id (raw MusicBrainz UUID), title, duration secs)`.
#[derive(Debug, Clone)]
pub struct BoxMedium {
    pub position: i32,
    pub tracks: Vec<(String, String, Option<i32>)>,
}

/// A release MusicBrainz considers a single Release with N media - the box itself.
#[derive(Debug, Clone)]
pub struct BoxCandidate {
    pub release_id: String,
    pub media: Vec<BoxMedium>,
}

#[derive(Debug)]
pub struct BoxBindPlan {
    pub release_id: String,
    pub folder_path: String,
    pub survivor: String,
    pub absorbed: Vec<String>,
    /// (local_id, medium position) for every sibling, survivor included.
    pub members: Vec<(String, i32)>,
    /// (local track id, MB track raw UUID) across every matched sibling, for relinking
    /// `LocalReleaseTrack.mbTrackId` once the candidate's tracks are persisted.
    pub track_links: Vec<(String, String)>,
}

fn common_ancestor(a: &str, b: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for (sa, sb) in a.split('/').zip(b.split('/')) {
        if sa != sb {
            break;
        }
        out.push(sa);
    }
    out.join("/")
}

/// How far apart two runtimes of the same recording may sit, per pass of the ladder in
/// `pair_tracks`. Pass 1 keeps `owned::durations_compatible`'s own 5s; the widenings below are named
/// here so the ladder reads as one rule set rather than three magic numbers.
///
/// Rips, masterings and gapless trailing silence move a track by a few seconds. Requiring 5s cost
/// ABBA's "The Complete Studio Recordings" its entire nine-disc bind over one track: disc 5's "I'm a
/// Marionette" is 243s in the files against MusicBrainz's 249s, on a disc whose eleven titles
/// otherwise line up exactly. Still bounded, because a shared title with a wildly different runtime is
/// usually a different recording - a live take, an extended mix - not a different rip of the same one.
pub(crate) const SAME_TRACK_DIFFERENT_MASTER_SECS: i32 = 15;

/// Only reachable on a disc that has *already* paired `CORROBORATION_MIN_EXACT_PAIRS` tracks by exact
/// title. At that point the folder's identity is established by those pairings, and a lone same-titled
/// outlier is a different master of a slot the rest of the disc already proved - not evidence that the
/// folder is a different disc. Deliberately **not** applied as a flat window (docs/sync_decisions.md
/// §9: "a shared title with a wildly different runtime is usually a different recording"); without the
/// corroboration requirement this would be exactly that loosening.
const CORROBORATED_DRIFT_SECS: i32 = 60;
const CORROBORATION_MIN_EXACT_PAIRS: usize = 3;

/// One medium track still up for grabs, pre-normalized once so the ladder below never re-normalizes.
struct MediumTrack {
    /// Index back into the caller's `medium` slice, for the MB track id.
    idx: usize,
    norm: String,
    /// `norm` of the title with trailing qualifiers stripped - empty when there is no base title.
    base: String,
    secs: Option<i32>,
}

/// One local track not yet paired, same pre-normalization.
struct LocalTrack<'a> {
    id: &'a String,
    norm: String,
    base: String,
    secs: Option<i32>,
}

/// Claim every leftover whose predicate matches exactly one remaining medium track, greedily in the
/// order given. Returns the leftovers that matched nothing, or `None` the moment one matches more than
/// one - ambiguity refuses rather than guesses.
fn claim_unique<'a, F>(
    available: &mut Vec<MediumTrack>,
    medium: &[(String, String, Option<i32>)],
    links: &mut Vec<(String, String)>,
    unresolved: Vec<LocalTrack<'a>>,
    fits: F,
) -> Option<Vec<LocalTrack<'a>>>
where
    F: Fn(&LocalTrack<'a>, &MediumTrack) -> bool,
{
    let mut left = Vec::new();
    for track in unresolved {
        let mut found = None;
        let mut hits = 0usize;
        for (pos, candidate) in available.iter().enumerate() {
            if fits(&track, candidate) {
                hits += 1;
                if hits > 1 {
                    break;
                }
                found = Some(pos);
            }
        }
        if hits > 1 {
            return None;
        }
        match found {
            Some(pos) => {
                let claimed = available.remove(pos);
                links.push((track.id.clone(), medium[claimed.idx].0.clone()));
            }
            None => left.push(track),
        }
    }
    Some(left)
}

/// How many strictness levels `pair_tracks_at` offers. Level 0 is the historical ladder exactly;
/// each level above it enables one more (looser) rule. See `pair_tracks`.
const PAIR_DEPTH_MAX: usize = 3;

/// Pair a folder's tracks against a medium's, one-to-one, returning `(local_track_id, mb_track_id)`
/// for every track - or `None` when the two are not the same tracklist at this strictness `depth`.
///
/// Same length is still required (this decides "is this folder *that* disc", not containment), but the
/// pairing is by **content, not position**: each local track claims a distinct medium track with the
/// same normalized title and a compatible duration, in any order.
///
/// Position (a naive `zip` of the two lists) is not a safe substitute for content matching: a disc
/// can be a perfect rip of every MusicBrainz track while carrying them in a different sequence than
/// MusicBrainz lists them, and pairing by position alone would reject that disc - which in turn makes
/// `plan_box_bind` reject the **whole** group over one correctly-ripped, differently-ordered disc.
///
/// The rules, strictest first. **The order is the safety property**: anything placeable beyond doubt
/// is claimed before a looser rule gets to compete for it, so a loose match can never steal a track a
/// strict one had a claim on.
///
/// | Rule | Window | Unique required | From depth |
/// |---|---|---|---|
/// | normalized title equal              | 5s  | no (greedy) | 0 |
/// | normalized title equal              | 15s | no (greedy) | 0 |
/// | normalized title equal, 3+ already paired | 60s | yes | 1 |
/// | one title contains the other        | 5s  | yes | 0 |
/// | one title contains the other        | 15s | yes | 1 |
/// | titles equal minus a trailing qualifier | 5s then 15s | yes | 2 |
/// | near-identical titles (typo), both durations known | 5s then 15s | yes | 3 |
///
/// Greedy is correct for the first two, matching `owned::find_owning_bundle`'s own approach: two tracks
/// sharing a title *and* a runtime are interchangeable. Every looser rule demands a unique candidate,
/// and a pathological set where only a different assignment would succeed is left unmatched rather than
/// guessed at.
pub(crate) fn pair_tracks_at(
    local: &[(String, String, Option<i32>)],
    medium: &[(String, String, Option<i32>)],
    depth: usize,
) -> Option<Vec<(String, String)>> {
    if local.len() != medium.len() {
        return None;
    }
    let mut available: Vec<MediumTrack> = medium
        .iter()
        .enumerate()
        .map(|(idx, (_, title, secs))| MediumTrack {
            idx,
            norm: normalize_title(title),
            base: normalize_title(&strip_qualifier(title)),
            secs: *secs,
        })
        .collect();

    let mut links: Vec<(String, String)> = Vec::with_capacity(local.len());
    let mut unresolved: Vec<LocalTrack> = local
        .iter()
        .map(|(id, title, secs)| LocalTrack {
            id,
            norm: normalize_title(title),
            base: normalize_title(&strip_qualifier(title)),
            secs: *secs,
        })
        .collect();

    // Identical title, runtimes agreeing closely, then merely in the same region.
    for window in [None, Some(SAME_TRACK_DIFFERENT_MASTER_SECS)] {
        let mut left = Vec::new();
        for track in unresolved {
            let fits = |m: &MediumTrack| {
                m.norm == track.norm
                    && match window {
                        None => durations_compatible(track.secs, m.secs),
                        Some(secs) => durations_within(track.secs, m.secs, secs),
                    }
            };
            match available.iter().position(fits) {
                Some(pos) => {
                    let claimed = available.remove(pos);
                    links.push((track.id.clone(), medium[claimed.idx].0.clone()));
                }
                None => left.push(track),
            }
        }
        unresolved = left;
    }

    // Identical title a whole minute out, but only once the rest of the disc has already vouched for
    // it. See `CORROBORATED_DRIFT_SECS`.
    if depth >= 1 && links.len() >= CORROBORATION_MIN_EXACT_PAIRS {
        unresolved = claim_unique(
            &mut available,
            medium,
            &mut links,
            unresolved,
            |track, candidate| {
                candidate.norm == track.norm
                    && durations_within(track.secs, candidate.secs, CORROBORATED_DRIFT_SECS)
            },
        )?;
    }

    // A title that merely *contains* the other. Tags routinely qualify a track MusicBrainz leaves
    // plain, or the reverse: ABBA's "The Complete Studio Recordings" disc 1 is a perfect 19-of-19 rip
    // whose opener is tagged "Ring Ring (English version)" where MusicBrainz says "Ring Ring", and that
    // single word rejected the entire nine-disc box.
    //
    // Running this greedily would be actively dangerous: that same disc also holds the Spanish, German
    // and Swedish "Ring Ring", whose durations sit within tolerance of the plain one, so first-fit
    // would pair whichever came first. Exact-first plus the uniqueness test removes both hazards.
    let containment_windows: &[i32] = if depth >= 1 {
        &CLAIM_WINDOWS
    } else {
        &CLAIM_WINDOWS[..1]
    };
    for &window in containment_windows {
        unresolved = claim_unique(
            &mut available,
            medium,
            &mut links,
            unresolved,
            |track, candidate| {
                (candidate.norm.contains(track.norm.as_str())
                    || track.norm.contains(candidate.norm.as_str()))
                    && durations_within(track.secs, candidate.secs, window)
            },
        )?;
    }

    // The two titles agree once each side's trailing qualifier is dropped. Containment above cannot see
    // this, because *both* sides carry a qualifier and neither contains the other: Marillion's "The
    // Singles '82-88'" disc 4 is tagged "Market Square Heroes (alternative version)" where MusicBrainz
    // says "Market Square Heroes (re-record)", same 288s, and that one track cost the whole twelve-disc
    // box its placement.
    //
    // Two differently-qualified variants of one base title (the four language versions of "Ring Ring")
    // both fit, so the uniqueness test refuses - the same protection containment relies on.
    if depth >= 2 {
        for window in CLAIM_WINDOWS {
            unresolved = claim_unique(
                &mut available,
                medium,
                &mut links,
                unresolved,
                |track, candidate| {
                    !track.base.is_empty()
                        && track.base == candidate.base
                        && durations_within(track.secs, candidate.secs, window)
                },
            )?;
        }
    }

    // A tagging typo ("Sweet Emalina My Gal" for "Sweet Emaline My Gal", "Frearm Smash" for "Forearm
    // Smash"). The weakest evidence on the ladder, so it is also the most constrained: both durations
    // must actually be known, not merely non-contradictory, on top of the usual window and uniqueness.
    if depth >= 3 {
        for window in CLAIM_WINDOWS {
            unresolved = claim_unique(
                &mut available,
                medium,
                &mut links,
                unresolved,
                |track, candidate| {
                    track.secs.is_some()
                        && candidate.secs.is_some()
                        && durations_within(track.secs, candidate.secs, window)
                        && titles_near_identical(&track.norm, &candidate.norm)
                },
            )?;
        }
    }

    unresolved.is_empty().then_some(links)
}

/// The duration windows a unique-claim rule tries, tightest first.
///
/// Trying 5s before 15s is not cosmetic: widening a window can turn a rule's single candidate into
/// two, and `claim_unique` then refuses. Claiming at the tight window first means a pairing a
/// 5s-only rule would find is always found, and the wider window only ever sees what the tight one
/// could not place - trying the wide window first can turn a group that would otherwise bind into
/// one that doesn't, over a pairing the tight window alone would have resolved cleanly.
const CLAIM_WINDOWS: [i32; 2] = [
    crate::owned::DURATION_TOLERANCE_SECS,
    SAME_TRACK_DIFFERENT_MASTER_SECS,
];

/// `pair_tracks_at` at whichever strictness level first produces a pairing.
///
/// Production code never wants this: `plan_box_bind_detailed` has to compare a folder against every
/// medium at *equal* strictness, so it drives the levels itself. Kept for the tests, which are about
/// whether a given tracklist pairs at all rather than at which level.
#[cfg(test)]
pub(crate) fn pair_tracks(
    local: &[(String, String, Option<i32>)],
    medium: &[(String, String, Option<i32>)],
) -> Option<Vec<(String, String)>> {
    (0..=PAIR_DEPTH_MAX).find_map(|depth| pair_tracks_at(local, medium, depth))
}

/// Why `plan_box_bind_detailed` refused a candidate. Carried so the caller can both log a precise
/// reason and count refusals by kind - a bare `None` made half the box pass' work invisible in the run
/// summary, which is how a transient MusicBrainz outage stayed indistinguishable from "this group has
/// no box release" for an entire rollout (docs/specs/spec_tidy_observations.md).
#[derive(Debug, Clone)]
pub enum BindRefusal {
    /// Fewer than two siblings, or fewer than two of them matched a medium - nothing to fold.
    TooFewMatched { matched: usize },
    /// A sibling matched more than one medium of this candidate.
    Ambiguous { folder: String, media: usize },
    /// Two siblings both resolved to the same medium - duplicate rips, not two halves of a box.
    Collision {
        folder: String,
        other: String,
        position: i32,
    },
}

impl BindRefusal {
    /// One line for `reporter.skip` and `errors.log`, naming the release it was checked against.
    pub fn describe(&self, release_title: &str) -> String {
        match self {
            BindRefusal::TooFewMatched { matched } => format!(
                "only {} sibling(s) matched a disc of \"{}\" - at least 2 required",
                matched, release_title
            ),
            BindRefusal::Ambiguous { folder, media } => format!(
                "[{}] matches {} discs of \"{}\" - ambiguous",
                folder, media, release_title
            ),
            BindRefusal::Collision {
                folder,
                other,
                position,
            } => format!(
                "[{}] and [{}] both match disc {} of \"{}\"",
                other, folder, position, release_title
            ),
        }
    }

    /// Stable key for the run summary's per-reason counters.
    pub fn kind(&self) -> &'static str {
        match self {
            BindRefusal::TooFewMatched { .. } => "no match",
            BindRefusal::Ambiguous { .. } => "ambiguous",
            BindRefusal::Collision { .. } => "collision",
        }
    }
}

/// Decide whether `siblings` are discs of `candidate`, and how.
///
/// Refuses when a sibling matches **more than one** medium (ambiguous), when two siblings claim the
/// same medium, or when fewer than two siblings resolve at all - there is nothing to fold below two.
///
/// A sibling that matches **zero** media must not refuse the whole group (docs/sync_decisions.md §19
/// item 1b). Real boxes routinely carry a folder that is on no disc of any edition: a bonus DVD-audio
/// rip, a hi-res or SACD layer sitting beside the CD rip, a disc whose tracklist the rip split
/// differently. Refusing the whole box over one such folder, when every other folder in the group
/// paired perfectly, is the single largest avoidable cause of unplaced discs. Unmatched siblings are
/// simply left out of `members`/`absorbed`/`track_links`, so `apply_fold` never deletes them and
/// `apply_dissolve` never writes to them: nothing about those rows changes.
///
/// An *ambiguous* sibling still refuses the whole group. That distinction is the safety property - "on
/// no disc" is evidence about that folder alone, "could be either disc" is evidence that the candidate
/// itself is wrong.
///
/// The partial bind also needs a **majority** of the folders to resolve, not merely two of them. Below
/// that, "one folder does not fit" stops being the right reading and "this is not the box" becomes the
/// likelier one.
///
/// A candidate medium with no matching sibling is fine either way - a partially-ripped box is allowed.
pub fn plan_box_bind_detailed(
    siblings: &[BoxSibling],
    candidate: &BoxCandidate,
) -> Result<BoxBindPlan, BindRefusal> {
    if siblings.len() < 2 {
        return Err(BindRefusal::TooFewMatched { matched: 0 });
    }

    let mut claimed: HashMap<i32, String> = HashMap::new();
    let mut members: Vec<(String, i32)> = Vec::with_capacity(siblings.len());
    let mut track_links: Vec<(String, String)> = Vec::new();

    for s in siblings {
        // Strictest-first at the *medium* level too, not just inside `pair_tracks_at`. A folder that
        // pairs with exactly one disc under the tight rules must keep that disc even though a looser
        // level would also pair it with a second one - otherwise widening a rule turns a settled
        // answer into an ambiguity and the group stops binding. Measured library-wide: without this,
        // two groups that bound before would refuse (Rome's "Hall Of Thatch", whose disc pairs with
        // two masterings of the same album once the 60s window opens).
        let hits: Vec<(&BoxMedium, Vec<(String, String)>)> = (0..=PAIR_DEPTH_MAX)
            .map(|depth| {
                candidate
                    .media
                    .iter()
                    .filter_map(|m| {
                        pair_tracks_at(&s.tracks, &m.tracks, depth).map(|links| (m, links))
                    })
                    .collect::<Vec<_>>()
            })
            .find(|hits: &Vec<_>| !hits.is_empty())
            .unwrap_or_default();
        let (medium, links) = match &hits[..] {
            [one] => one,
            // On no disc of this candidate: leave the folder exactly as it is and carry on.
            [] => continue,
            many => {
                return Err(BindRefusal::Ambiguous {
                    folder: s.folder_path.clone(),
                    media: many.len(),
                })
            }
        };
        if let Some(other) = claimed.insert(medium.position, s.folder_path.clone()) {
            return Err(BindRefusal::Collision {
                folder: s.folder_path.clone(),
                other,
                position: medium.position,
            });
        }
        members.push((s.local_id.clone(), medium.position));
        // The pairing computed by `pair_tracks`, not a positional zip - on a disc whose sequencing
        // differs from MusicBrainz's, zipping linked every track to the wrong recording.
        track_links.extend(links.iter().cloned());
    }

    // Two independent floors, and the second matters as much as the first. A group where only a
    // handful of folders resolve is weak evidence that this candidate is the group's box at all -
    // binding 2 of a 16-folder group would fold those two into one release and leave fourteen loose,
    // which reads worse on screen than the unplaced state it replaced. Measured across the library,
    // requiring a majority costs 21 of 347 binds and removes every case of that shape (Pink Floyd's
    // "Oh By The Way" at 2 of 16, Elvis's 60CD box at 10 of 60).
    if members.len() < 2 || members.len() * 2 < siblings.len() {
        return Err(BindRefusal::TooFewMatched {
            matched: members.len(),
        });
    }

    let mut ordered = members.clone();
    ordered.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    let survivor = ordered[0].0.clone();
    let absorbed: Vec<String> = ordered.into_iter().skip(1).map(|(id, _)| id).collect();

    // The box root, computed over *every* sibling including the unmatched ones - the folder they all
    // sit in is the box regardless of which discs MusicBrainz happens to list.
    let folder_path = siblings
        .iter()
        .map(|s| s.folder_path.clone())
        .reduce(|acc, f| common_ancestor(&acc, &f))
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| siblings[0].folder_path.clone());

    Ok(BoxBindPlan {
        release_id: candidate.release_id.clone(),
        folder_path,
        survivor,
        absorbed,
        members,
        track_links,
    })
}

/// `plan_box_bind_detailed` without the reason, for callers that only need the decision.
pub fn plan_box_bind(siblings: &[BoxSibling], candidate: &BoxCandidate) -> Option<BoxBindPlan> {
    plan_box_bind_detailed(siblings, candidate).ok()
}

// ---------------------------------------------------------------------------
