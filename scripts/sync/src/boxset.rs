//! Box-set binding: matches sibling disc folders index left unmerged (index never folds,
//! docs/sync_decisions.md) to a box's *media* by tracklist, since MusicBrainz box sets don't carry the
//! id discipline plain multi-disc detection relies on. Two shapes handled identically:
//!
//!   (a) one disc mis-tagged as the standalone album (embedded ids disjoint, not unanimous)
//!   (b) every disc tagged as its own standalone album (embedded ids differ entirely, and often
//!       every sibling reads discNumber=1 since no file was ever told it was part of a box)
//!
//! MusicBrainz has no box-set entity: a box is one Release with N media, and MB stores no link from
//! a box's disc to the standalone release it duplicates - the only shared identity is the recording
//! (docs/sync_decisions.md). This module matches siblings to *media* by tracklist, never by any id the
//! files carry, and accepts only a **perfect matching**: every sibling maps to exactly one medium,
//! with equal track count and every track's title+duration (±5s) agreeing - the same rule
//! `owned::find_owning_bundle` uses for the bonus-disc case. Any ambiguity rejects the whole group; a
//! box with some discs not owned at all is fine (a partial match), a box where a disc could equally
//! be two different media is not.
//!
//! Binding a box is only half the job: `run_repair` also decides, once equivalences are known, fold
//! (genuine multi-disc release) or dissolve (box set) - docs/sync_decisions.md.

use std::collections::{HashMap, HashSet};

use crate::box_editions;
use crate::db::*;
use crate::mb_api::{self, RateLimiter};
use crate::owned::{durations_compatible, durations_within, normalize_title};
use crate::title_rules::{strip_qualifier, titles_near_identical};
use chrono::Utc;
use colored::Colorize;
use common::mb::types::{MbMedia, MbRelease};
use common::progress::Reporter;
use reqwest::Client;
use sqlx::PgPool;

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
/// Order used to be load-bearing - the two lists were `zip`ped - and that silently rejected real
/// boxes. ABBA's "The Complete Studio Recordings (9CD)" is a perfect 9-of-9 rip whose disc 1 carries
/// exactly MusicBrainz's 19 tracks, but sequenced differently ("Åh, vilka tider" 3rd locally vs 14th
/// in MB, "Rock 'n Roll Band" last vs 12th). One such disc made `plan_box_bind` reject the **whole**
/// group, so a complete box stayed nine unbound `MISSING_TRACKS` folders.
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
fn pair_tracks_at(
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
/// two, and `claim_unique` then refuses. Claiming at the tight window first means a pairing the old
/// 5s-only rule found is always found again, and the wider window only ever sees what the tight one
/// could not place. Measured across the whole library, that ordering is the difference between 0 and 2
/// groups that used to bind and would otherwise stop binding.
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
fn pair_tracks(
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
/// A sibling that matches **zero** media no longer refuses the group (docs/sync_decisions.md §19 item
/// 1b). Real boxes routinely carry a folder that is on no disc of any edition: a bonus DVD-audio rip, a
/// hi-res or SACD layer sitting beside the CD rip, a disc whose tracklist the rip split differently.
/// Refusing the whole box over one of those was the single largest cause of unplaced discs measured in
/// the 2026-09-17 rollout - 126 groups where exactly one folder failed and every other folder paired
/// perfectly. Unmatched siblings are simply left out of `members`/`absorbed`/`track_links`, so
/// `apply_fold` never deletes them and `apply_dissolve` never writes to them: nothing about those rows
/// changes.
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
// Candidate discovery - network + DB
// ---------------------------------------------------------------------------

/// Where a candidate box release came from, and therefore what still has to happen to it before a
/// sibling can be bound to it.
enum CandidateSource {
    /// Fetched from MusicBrainz. Its `MusicBrainzRelease` + media + track rows must be persisted
    /// (`persist_box_media`) before anything can point at it.
    Fetched {
        release: MbRelease,
        rg_id: String,
        primary_type: Option<String>,
    },
    /// Rebuilt from rows this box already has in the database, with no MusicBrainz call at all - the
    /// whole point of `candidates_from_db`. Nothing to persist; the row id is already known.
    Stored { mb_db_id: String },
}

struct FetchedCandidate {
    candidate: BoxCandidate,
    /// The release's own title, for log lines - the one field both sources always have.
    title: String,
    source: CandidateSource,
}

/// Candidates plus how many MusicBrainz lookups failed while gathering them. A failed lookup is **not**
/// the same as "no box exists", and conflating the two is what let a transient outage look like a
/// settled negative for a whole rollout - see `BoxSetSummary::candidate_fetch_errors`.
#[derive(Default)]
struct CandidateFetch {
    candidates: Vec<FetchedCandidate>,
    errors: usize,
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
async fn candidates_from_embedded_ids(
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
                            release: by_id.release,
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
async fn candidates_from_search(
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
async fn candidates_from_release_group(
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
                        release,
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
async fn candidates_from_db(pool: &PgPool, mb_ids: &[String]) -> Vec<FetchedCandidate> {
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

        let Ok(track_rows) = sqlx::query_as::<_, (Option<i32>, Option<String>, String, Option<i32>)>(
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
fn box_candidate_from_rows(
    release_mb_id: &str,
    medium_rows: &[(i32, i32)],
    track_rows: &[(Option<i32>, Option<String>, String, Option<i32>)],
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
/// catalogue number in brackets, which MusicBrainz's own title never carries, used to return zero
/// search hits). Whichever bracket opens first is where the title ends - a folder can carry either
/// or both, in either order. MB search tolerates the rest, and the real gate is the track-level
/// perfect match in `plan_box_bind`, not this string.
fn guess_box_title(parent_folder: &str) -> String {
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
// Group discovery - DB only
// ---------------------------------------------------------------------------

struct SiblingRow {
    local_id: String,
    folder_path: String,
    /// Unanimous only (docs/no_guessing.md) - never a plurality. `NULL` when the folder's tracks
    /// carry no `mbReleaseId` at all, or disagree on it.
    unanimous_mb_release_id: Option<String>,
    /// This folder already sits on a medium (`mediumPosition`) or came out of a dissolve
    /// (`boxReleaseId`). A group where every sibling is placed needs no MusicBrainz call to be
    /// re-checked - see `candidates_from_db`.
    placed: bool,
}

struct SiblingGroup {
    parent: String,
    rows: Vec<SiblingRow>,
    /// Found by `nested_groups` - a root folder plus folders beneath it, all bound to one multi-disc
    /// release - rather than as folders sharing a parent. Its candidate is taken from the database
    /// first, since every member is by definition already bound to it.
    nested: bool,
}

/// Folders sharing a parent, at least two of them, none yet folded into one `LocalRelease` - the
/// same directory shape `multi_disc` looks at, but grouped by path rather than a shared embedded id,
/// since a box's siblings frequently carry entirely different (and individually correct-looking)
/// embedded release ids (shape (b), see module docs).
///
/// `scope`, when given, is a list of artist ids: a whole sibling group is kept if **any** folder in
/// it is owned by one of those artists (via `LocalReleaseArtist`) - siblings owned by a different,
/// unscoped artist stay in the group rather than being dropped out of it, since the box must be
/// bound/folded/dissolved as one unit regardless of which artist happened to trigger the run (a box
/// filed under a collaborator's folder still belongs to the artist credited on it - see
/// docs/sync_decisions.md). `None` scopes nothing (every group, tidy's `--all`).
async fn find_sibling_groups(
    pool: &PgPool,
    scope: Option<&[String]>,
) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>, bool)> = sqlx::query_as(
        r#"
        WITH f AS (
          SELECT lr.id, lr."folderPath" AS folder_path,
                 regexp_replace(lr."folderPath", '/[^/]+$', '') AS parent,
                 (SELECT CASE WHEN count(DISTINCT t."mbReleaseId") = 1
                              THEN min(t."mbReleaseId") END
                    FROM "LocalReleaseTrack" t
                   WHERE t."localReleaseId" = lr.id AND t."mbReleaseId" IS NOT NULL) AS unanimous_mb_release_id,
                 (lr."mediumPosition" IS NOT NULL OR lr."boxReleaseId" IS NOT NULL) AS placed
          FROM "LocalRelease" lr
          WHERE lr."folderPath" IS NOT NULL
            AND array_length(string_to_array(lr."folderPath", '/'), 1) >= 4
        )
        SELECT f.id, f.folder_path, f.parent, f.unanimous_mb_release_id, f.placed
        FROM f
        WHERE f.parent IN (SELECT parent FROM f GROUP BY parent HAVING count(*) > 1)
          AND ($1::text[] IS NULL OR f.parent IN (
                SELECT f2.parent FROM f f2
                JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = f2.id
                WHERE lra."artistId" = ANY($1)
              ))
        ORDER BY f.parent, f.folder_path
        "#,
    )
    .bind(scope)
    .fetch_all(pool)
    .await?;

    let mut groups: Vec<SiblingGroup> = Vec::new();
    for (id, folder_path, parent, unanimous_mb, placed) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            unanimous_mb_release_id: unanimous_mb,
            placed,
        };
        match groups.last_mut() {
            Some(g) if g.parent == parent => g.rows.push(row),
            _ => groups.push(SiblingGroup {
                parent,
                rows: vec![row],
                nested: false,
            }),
        }
    }

    let already_grouped: HashSet<String> = groups
        .iter()
        .flat_map(|g| g.rows.iter().map(|r| r.local_id.clone()))
        .collect();
    groups.extend(nested_groups(pool, scope, &already_grouped).await?);
    Ok(groups)
}

/// Discs filed as a **root folder plus subfolders** rather than as siblings: disc 1's files sit in the
/// release folder itself and disc 2 in a folder beneath it (`…/2004 - Blast Tyrant` holding CD 1,
/// `…/2004 - Blast Tyrant/CD 2 - Bonus Disc` holding CD 2). `find_sibling_groups` groups folders by
/// their common parent, so it never sees these two together - the root's parent is the artist's type
/// folder, not the album folder. Both were bound to the whole multi-disc release, never placed, and each
/// scored against the full tracklist: two `MISSING_TRACKS` cards for one complete album.
///
/// A group is a root `LocalRelease` plus every `LocalRelease` beneath its folder, all bound to the same
/// `mediumCount > 1` release, none yet placed (`mediumPosition`/`boxReleaseId`) or folded
/// (`LocalReleaseMember`). Once found, it goes through exactly the same bind / equivalence /
/// fold-or-dissolve pipeline as a sibling group - nothing about binding changes, only discovery.
///
/// Deliberately **not** grouped: folders bound to one release that sit in *unrelated* trees (two
/// spellings of an artist, a duplicate copy filed elsewhere). A root-plus-subfolder layout is evidence the
/// folders are one physical release; two separate trees is not.
///
/// A group sharing any folder with a sibling group is skipped, so the box pass keeps handling those
/// exactly as before. Roots are taken shortest path first and a folder is only ever used once, so a
/// three-level tree cannot produce two overlapping groups.
async fn nested_groups(
    pool: &PgPool,
    scope: Option<&[String]>,
    already_grouped: &HashSet<String>,
) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        WITH lr AS (
          SELECT l.id, l."folderPath" AS fp, l."releaseId" AS rid
          FROM "LocalRelease" l
          WHERE l."folderPath" IS NOT NULL AND l."releaseId" IS NOT NULL
            AND l."mediumPosition" IS NULL AND l."boxReleaseId" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = l.id)
        ),
        roots AS (
          SELECT r.id AS root_id, r.fp AS root_fp, r.rid
          FROM lr r
          JOIN "MusicBrainzRelease" m ON m.id = r.rid AND m."mediumCount" > 1
          WHERE EXISTS (SELECT 1 FROM lr c
                        WHERE c.rid = r.rid AND left(c.fp, length(r.fp) + 1) = r.fp || '/')
        ),
        members AS (
          SELECT r.root_fp, c.id, c.fp
          FROM roots r
          JOIN lr c ON c.rid = r.rid
                   AND (c.id = r.root_id OR left(c.fp, length(r.root_fp) + 1) = r.root_fp || '/')
        )
        SELECT mem.root_fp, mem.id, mem.fp,
               (SELECT CASE WHEN count(DISTINCT t."mbReleaseId") = 1
                            THEN min(t."mbReleaseId") END
                  FROM "LocalReleaseTrack" t
                 WHERE t."localReleaseId" = mem.id AND t."mbReleaseId" IS NOT NULL)
        FROM members mem
        WHERE $1::text[] IS NULL OR mem.root_fp IN (
                SELECT m2.root_fp FROM members m2
                JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = m2.id
                WHERE lra."artistId" = ANY($1))
        ORDER BY length(mem.root_fp), mem.root_fp, mem.fp
        "#,
    )
    .bind(scope)
    .fetch_all(pool)
    .await?;

    let mut candidates: Vec<SiblingGroup> = Vec::new();
    for (root, id, folder_path, unanimous_mb) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            unanimous_mb_release_id: unanimous_mb,
            placed: false,
        };
        match candidates.last_mut() {
            Some(g) if g.parent == root => g.rows.push(row),
            _ => candidates.push(SiblingGroup {
                parent: root,
                rows: vec![row],
                nested: true,
            }),
        }
    }

    Ok(keep_disjoint_groups(candidates, already_grouped))
}

/// Keep candidate groups in order, dropping any that shares a folder with a sibling group or with a
/// group already kept, and any under two folders. Candidates arrive shortest root path first, so an
/// outer root always claims its whole tree before a nested sub-root could claim part of it.
fn keep_disjoint_groups(
    candidates: Vec<SiblingGroup>,
    already_grouped: &HashSet<String>,
) -> Vec<SiblingGroup> {
    let mut used: HashSet<String> = HashSet::new();
    let mut groups = Vec::new();
    for g in candidates {
        let overlaps = g
            .rows
            .iter()
            .any(|r| already_grouped.contains(&r.local_id) || used.contains(&r.local_id));
        if overlaps || g.rows.len() < 2 {
            continue;
        }
        used.extend(g.rows.iter().map(|r| r.local_id.clone()));
        groups.push(g);
    }
    groups
}

async fn sibling_tracks(
    pool: &PgPool,
    local_id: &str,
) -> Result<Vec<(String, String, Option<i32>)>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<i32>)> = sqlx::query_as(
        r#"SELECT id, title, duration FROM "LocalReleaseTrack"
           WHERE "localReleaseId" = $1
           ORDER BY "trackNumber" ASC NULLS LAST, id ASC"#,
    )
    .bind(local_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, dur)| (id, title.unwrap_or_default(), dur))
        .collect())
}

/// The MB id(s) of any `mediumCount > 1` release a sibling in this group is *already* bound to - a
/// disc the ordinary album matcher bound whole-box (tags name the box, not the disc; see §10) already
/// names the right release, so re-discovering it by tag consensus or MB search is redundant, and for a
/// library with no useful tags at all (every embedded id absent or pointing elsewhere) it is the only
/// source that finds the box. Merged into tier (a)'s id set, so no extra MB call when the two agree.
async fn bound_box_mb_ids(pool: &PgPool, local_ids: &[String]) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        r#"SELECT DISTINCT m."musicbrainzId" FROM "LocalRelease" lr
           JOIN "MusicBrainzRelease" m ON m.id = lr."releaseId"
           WHERE lr.id = ANY($1) AND m."mediumCount" > 1"#,
    )
    .bind(local_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

async fn artist_for_group(pool: &PgPool, local_ids: &[String]) -> Option<(String, String)> {
    sqlx::query_as(
        r#"SELECT a.id, a.name FROM "Artist" a
           JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
           WHERE lra."localReleaseId" = ANY($1)
           LIMIT 1"#,
    )
    .bind(local_ids)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

// ---------------------------------------------------------------------------
// Apply - persist a successful plan
// ---------------------------------------------------------------------------

/// Persist the box's own `MusicBrainzRelease` + media + tracks. Pure MB-side work, no `LocalRelease`
/// mutation - the caller decides fold vs dissolve afterward (docs/sync_decisions.md), once
/// `box_editions::run_link_box_editions` has had a chance to derive equivalences, which needs these
/// media rows to exist first. Returns the box's `MusicBrainzRelease.id`.
#[allow(clippy::too_many_arguments)]
async fn persist_box_media(
    pool: &PgPool,
    release: &MbRelease,
    rg_id: &str,
    primary_type: Option<&str>,
    candidate: &BoxCandidate,
    plan: &BoxBindPlan,
    release_type_cache: &mut HashMap<String, String>,
    artist_id: &str,
    artist_genre_ids: &[String],
) -> Result<String, sqlx::Error> {
    let type_name = primary_type.unwrap_or("Other");
    let type_id = ensure_release_type_cached(pool, type_name, release_type_cache).await?;
    let year = release
        .date
        .as_deref()
        .and_then(|d| d.split('-').next())
        .and_then(|y| y.parse::<i32>().ok());
    let format_str = crate::status::format_from_media(&release.media);
    let extras = MbReleaseExtras {
        release_date: release.date.as_deref(),
        packaging: release.packaging.as_deref(),
        country: release.country.as_deref(),
        format: format_str.as_deref(),
        ..Default::default()
    };
    // Box-level status only, at this stage: whether every medium is owned by some sibling. Per-disc
    // status (COMPLETE/MISSING_TRACKS scored against the right target, fold or dissolved) is left
    // UNKNOWN by apply_fold/apply_dissolve below and picked up by the ordinary bind path's
    // medium-scoped check_release_status on this artist's next sync pass - the same "next sync
    // re-scores it" convention the old tier-1 fold already relied on.
    let complete = plan.members.len() == candidate.media.len();
    let status = if complete {
        "COMPLETE"
    } else {
        "MISSING_TRACKS"
    };
    let reason = (!complete).then(|| {
        format!(
            "{} of {} discs present",
            plan.members.len(),
            candidate.media.len()
        )
    });

    let mb_db_id = upsert_mb_release_with_media(
        pool,
        &plan.release_id,
        rg_id,
        &release.title,
        year,
        &type_id,
        status,
        reason.as_deref(),
        release.disambiguation.as_deref(),
        &extras,
        candidate.media.len() as i32,
    )
    .await?;
    sync_mb_media_for_release(pool, &mb_db_id, &mb_medium_rows(&release.media)).await?;
    ensure_mb_release_artist_link(pool, &mb_db_id, artist_id)
        .await
        .ok();
    batch_link_release_genres(pool, &mb_db_id, artist_genre_ids)
        .await
        .ok();

    let flattened = common::mb::api::flatten_audio_tracks(&release.media);
    let track_rows: Vec<MbTrackRow> = flattened
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
    let inserted = sync_mb_tracks_for_release(pool, &mb_db_id, &track_rows).await?;

    // Link each sibling's local tracks to the box's own MB track rows. Kept the same for both fold
    // and dissolve outcomes as a deliberate simplification: after a dissolve the tracks conceptually
    // belong to the equivalent target release, but re-matching them against the target's own track
    // rows is a second matching pass this rollout doesn't do - the linked recording is identical
    // either way (that's what the equivalence match already proved), just catalogued under the box's
    // release-scoped track id rather than the target's.
    let track_links: Vec<(String, String)> = plan
        .track_links
        .iter()
        .filter_map(|(local_id, mb_raw)| {
            inserted
                .iter()
                .find(|(_, mid)| mid.as_deref() == Some(mb_raw.as_str()))
                .map(|(db_id, _)| (local_id.clone(), db_id.clone()))
        })
        .collect();
    link_local_tracks_to_mb(pool, &track_links).await.ok();

    Ok(mb_db_id)
}

// ---------------------------------------------------------------------------
// Fold vs dissolve (docs/sync_decisions.md)
// ---------------------------------------------------------------------------

enum BoxOutcome {
    Fold,
    Dissolve,
}

/// Flat `>= 2` threshold, no "majority" clause, at every box size - a 9-medium box with only 2
/// confirmed equivalents still dissolves; its other 7 discs correctly render as their own box-disc
/// rows rather than hiding 2 known editions inside one folded card.
fn decide_outcome(equivalent_count: usize) -> BoxOutcome {
    if equivalent_count >= 2 {
        BoxOutcome::Dissolve
    } else {
        BoxOutcome::Fold
    }
}

async fn count_equivalents(pool: &PgPool, mb_db_id: &str) -> Result<usize, sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT count(*) FROM "MusicBrainzReleaseMedium"
           WHERE "releaseId" = $1 AND "equivalentReleaseId" IS NOT NULL"#,
    )
    .bind(mb_db_id)
    .fetch_one(pool)
    .await?;
    Ok(count.max(0) as usize)
}

/// Genuine multi-disc release (0 or 1 equivalent medium): merge every sibling into one `LocalRelease`,
/// bound to the box itself. Folder-derived `groupKey` (`"folder:{ancestor}"`, never
/// `"mbrelease:{id}"` - the latter collides when two local copies of one box both plan the same key,
/// which is exactly what `./audit --duplicate-release` needs to be able to tell apart).
///
/// `Ok(false)` when the box's root folder is already its own, *different* `LocalRelease` (a real album
/// genuinely filed at that exact path - the fold would need to delete or rehome it, which is a
/// decision for a person, not something this repair invents on its own). Nothing is written; the
/// group is left as it is and counted separately (`groups_key_taken`).
async fn apply_fold(
    pool: &PgPool,
    plan: &BoxBindPlan,
    mb_db_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let local_ids: Vec<String> = plan.members.iter().map(|(id, _)| id.clone()).collect();
    let key_holder: Option<String> = sqlx::query_scalar(
        r#"SELECT id FROM "LocalRelease" WHERE "groupKey" = $1 AND id <> ALL($2)"#,
    )
    .bind(format!("folder:{}", plan.folder_path))
    .bind(&local_ids)
    .fetch_optional(pool)
    .await?;
    if key_holder.is_some() {
        return Ok(None);
    }

    let folder_rows: Vec<(String, Option<String>)> =
        sqlx::query_as(r#"SELECT id, "folderPath" FROM "LocalRelease" WHERE id = ANY($1)"#)
            .bind(&local_ids)
            .fetch_all(pool)
            .await?;
    let folder_by_id: HashMap<String, String> = folder_rows
        .into_iter()
        .map(|(id, fp)| (id, fp.unwrap_or_default()))
        .collect();

    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;

    // Stamp discNumber from the medium position BEFORE tracks move onto the survivor - once merged,
    // "which sibling did this track come from" is no longer recoverable from localReleaseId alone.
    for (local_id, position) in &plan.members {
        sqlx::query(
            r#"UPDATE "LocalReleaseTrack" SET "discNumber" = $1, "updatedAt" = $2 WHERE "localReleaseId" = $3"#,
        )
        .bind(position)
        .bind(now)
        .bind(local_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET "localReleaseId" = $1, "updatedAt" = $2 WHERE "localReleaseId" = ANY($3)"#,
    )
    .bind(&plan.survivor)
    .bind(now)
    .bind(&plan.absorbed)
    .execute(&mut *tx)
    .await?;
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1)"#)
        .bind(&plan.absorbed)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "groupKey" = $1, "folderPath" = $2, "releaseId" = $3, "mediumPosition" = NULL,
               "boxReleaseId" = NULL, "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN',
               "statusReason" = NULL, "updatedAt" = $4
           WHERE id = $5"#,
    )
    .bind(format!("folder:{}", plan.folder_path))
    .bind(&plan.folder_path)
    .bind(mb_db_id)
    .bind(now)
    .bind(&plan.survivor)
    .execute(&mut *tx)
    .await?;

    // One LocalReleaseMember per sibling (survivor included) so a plain re-index recognises every
    // folder next time instead of re-splitting a box whose discs all tag discNumber=1 (shape (b)).
    for (local_id, position) in &plan.members {
        let folder = folder_by_id
            .get(local_id.as_str())
            .map(String::as_str)
            .unwrap_or_default();
        let member_id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseMember" (id, "localReleaseId", "folderPath", "discNumber")
               VALUES ($1, $2, $3, $4)
               ON CONFLICT ("folderPath") DO UPDATE SET
                 "localReleaseId" = EXCLUDED."localReleaseId", "discNumber" = EXCLUDED."discNumber""#,
        )
        .bind(&member_id)
        .bind(&plan.survivor)
        .bind(folder)
        .bind(position)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Some(plan.survivor.clone()))
}

/// Box set (>=2 equivalent media): leave every sibling as its own `LocalRelease` row. Each disc binds
/// individually - to the standalone album it reprints (provenance recorded via `boxReleaseId`/
/// `boxMediumPosition`), or to the box itself when it has no equivalent (a rarities/bonus disc, or one
/// below tier 3's title/track-count gates). No `LocalReleaseMember` rows - dissolve never folds.
async fn apply_dissolve(
    pool: &PgPool,
    plan: &BoxBindPlan,
    mb_db_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    let mut changed: Vec<String> = Vec::new();
    for (local_id, position) in &plan.members {
        // LEFT JOINs the equivalent's own release row rather than trusting the id at face value: a
        // dangling `equivalentReleaseId` (the target release deleted after the equivalence was
        // derived - box_editions clears these before re-deriving, but a defensive check here costs
        // nothing) must read as "no equivalent" and bind to the box, never reach the foreign key that
        // column write would otherwise violate.
        let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
            r#"SELECT m."equivalentReleaseId", m."equivalentMediumPosition"
               FROM "MusicBrainzReleaseMedium" m
               LEFT JOIN "MusicBrainzRelease" target ON target.id = m."equivalentReleaseId"
               WHERE m."releaseId" = $1 AND m."position" = $2
                 AND (m."equivalentReleaseId" IS NULL OR target.id IS NOT NULL)"#,
        )
        .bind(mb_db_id)
        .bind(position)
        .fetch_optional(&mut *tx)
        .await?;
        let equivalent: Option<(String, Option<i32>)> =
            row.and_then(|(release_id, medium_position)| release_id.map(|r| (r, medium_position)));

        // `matchStatus = 'UNKNOWN'` means "score this again", so it must only be written when the
        // binding actually moves. This pass runs at the tail of *every* sync and re-derives the same
        // plan for a box that is already dissolved, so writing it unconditionally left those discs
        // permanently unscored: the release loop scored them, the tail reset them, and the next run
        // repeated it. ABBA's nine-disc box sat at UNKNOWN through three consecutive syncs that way.
        // The `WHERE` clauses below make each write a no-op once the row already says this.
        match equivalent {
            Some((equivalent_release_id, equivalent_medium_position)) => {
                let res = sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = $3,
                           "boxMediumPosition" = $4, "matchStatus" = 'UNKNOWN', "statusReason" = NULL,
                           "updatedAt" = $5
                       WHERE id = $6
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS DISTINCT FROM $3
                           OR "boxMediumPosition" IS DISTINCT FROM $4)"#,
                )
                .bind(&equivalent_release_id)
                .bind(equivalent_medium_position)
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(&mut *tx)
                .await?;
                if res.rows_affected() > 0 {
                    changed.push(local_id.clone());
                }
            }
            None => {
                let res = sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = NULL,
                           "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN', "statusReason" = NULL,
                           "updatedAt" = $3
                       WHERE id = $4
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS NOT NULL
                           OR "boxMediumPosition" IS NOT NULL)"#,
                )
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(&mut *tx)
                .await?;
                if res.rows_affected() > 0 {
                    changed.push(local_id.clone());
                }
            }
        }
    }
    tx.commit().await?;
    Ok(changed)
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct BoxSetSummary {
    pub groups_seen: usize,
    pub groups_bound: usize,
    pub rows_absorbed: usize,
    pub groups_folded: usize,
    pub groups_dissolved: usize,
    /// Left as-is: the box's root folder is already a different `LocalRelease` at that exact path.
    /// See `apply_fold`.
    pub groups_key_taken: usize,
    /// A DB error while binding, persisting, folding or dissolving *this one* group. Logged with the
    /// group's folder and the error (`common::error_log::log_warn`), then skipped - one bad box must
    /// never stop every group after it (docs/sync_decisions.md §9 "One box never blocks the rest";
    /// this is what the 2026-09-06/09-10 outages taught).
    pub groups_failed: usize,
    /// Every `LocalRelease` id a fold or dissolve actually changed this run: the survivor id from a
    /// fold, each member whose row a dissolve wrote to. Tidy re-scores exactly these, in addition to
    /// whatever was already sitting at `matchStatus='UNKNOWN'` from a previous, interrupted run.
    pub touched_local_release_ids: Vec<String>,

    // -- Why the rest were not bound. `groups_seen` minus `groups_bound` used to be a number with no
    // -- explanation anywhere, which is how a MusicBrainz outage hid inside it for a whole rollout.
    /// Fewer than two sibling folders survived to be considered - can never bind, so excluded from
    /// `groups_seen` rather than silently inflating it.
    pub groups_under_two_siblings: usize,
    /// No `LocalReleaseArtist` row for any sibling, so there is no artist to credit the box to.
    pub groups_skipped_no_artist: usize,
    /// Every tier came back empty: no embedded id resolved to a multi-medium release, the search found
    /// nothing. A settled negative, unlike `candidate_fetch_errors`.
    pub groups_no_candidate: usize,
    /// Candidates were found and checked, but fewer than two siblings matched a disc.
    pub groups_refused_no_match: usize,
    /// A sibling matched more than one disc of every candidate.
    pub groups_refused_ambiguous: usize,
    /// Two siblings resolved to the same disc of every candidate.
    pub groups_refused_collision: usize,
    /// Individual MusicBrainz lookups that errored while gathering candidates. Counted and logged, not
    /// swallowed: a group that failed only because MusicBrainz was unwell must be retried, which is
    /// what `artists_with_fetch_errors` buys.
    pub candidate_fetch_errors: usize,
    /// Artists owning a group where a lookup errored. Tidy withholds the `lastTidiedAt` stamp from
    /// exactly these, so the next run retries them instead of treating a 503 as a settled answer.
    pub artists_with_fetch_errors: HashSet<String>,
    /// Groups whose candidate came from the database instead of MusicBrainz (`candidates_from_db`).
    pub groups_from_db: usize,
}

impl BoxSetSummary {
    /// The per-reason tail of the run summary's `Box groups` line. Empty when everything bound.
    pub fn refusal_breakdown(&self) -> String {
        let parts = [
            ("no candidate", self.groups_no_candidate),
            ("fetch error", self.candidate_fetch_errors),
            ("no match", self.groups_refused_no_match),
            ("ambiguous", self.groups_refused_ambiguous),
            ("collision", self.groups_refused_collision),
            ("no artist link", self.groups_skipped_no_artist),
            ("under 2 siblings", self.groups_under_two_siblings),
        ];
        parts
            .iter()
            .filter(|(_, n)| *n > 0)
            .map(|(label, n)| format!("{n} {label}"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Log and count a group no candidate could bind. Each candidate contributes one reason; the group is
/// attributed to the *first* one, which is the candidate the ordinary matcher had already chosen and so
/// the most useful single answer.
fn report_refusals(
    summary: &mut BoxSetSummary,
    reporter: &Reporter,
    refusals: &[(String, BindRefusal)],
) {
    match refusals.first() {
        Some((_, first)) => match first {
            BindRefusal::TooFewMatched { .. } => summary.groups_refused_no_match += 1,
            BindRefusal::Ambiguous { .. } => summary.groups_refused_ambiguous += 1,
            BindRefusal::Collision { .. } => summary.groups_refused_collision += 1,
        },
        None => summary.groups_no_candidate += 1,
    }
    let detail: Vec<String> = refusals
        .iter()
        .map(|(title, r)| r.describe(title))
        .collect();
    reporter.skip(&format!(
        "{} candidate(s) checked, none matched: {}",
        detail.len(),
        detail.join("; ")
    ));
}

/// The `CandidateSource::Stored` twin of the track relinking `persist_box_media` does at its tail:
/// `plan.track_links` carries raw MusicBrainz track uuids, which have to be resolved to this release's
/// own `MusicBrainzReleaseTrack.id` values before they can be written.
async fn relink_stored_tracks(
    pool: &PgPool,
    mb_db_id: &str,
    plan: &BoxBindPlan,
) -> Result<(), sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "musicbrainzId" FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(mb_db_id)
    .fetch_all(pool)
    .await?;
    let links: Vec<(String, String)> = plan
        .track_links
        .iter()
        .filter_map(|(local_id, mb_raw)| {
            rows.iter()
                .find(|(_, mb_id)| mb_id.as_deref() == Some(mb_raw.as_str()))
                .map(|(db_id, _)| (local_id.clone(), db_id.clone()))
        })
        .collect();
    link_local_tracks_to_mb(pool, &links).await
}

#[allow(clippy::too_many_arguments)]
/// Two phases, in order:
///
///   1. Bind every matched sibling group's box to its own `MusicBrainzRelease` + media + tracks
///      (`persist_box_media`) - no `LocalRelease` writes yet, that decision needs equivalences.
///   2. Once every box in this run has its media persisted, derive equivalences once
///      (`box_editions::run_link_box_editions`, whole-catalogue but cheap - pure SQL for tier 1,
///      artist-scoped for tiers 2/3) and only then decide fold vs dissolve per box and write it
///      (docs/sync_decisions.md).
///
/// No dry-run (docs/sync_decisions.md - the user's `./backup` is the recovery path). `scope` (artist
/// ids) picks which sibling groups are considered - called once per tidy invocation with that
/// invocation's own scope, not once per artist inside a loop (this pass' own group-discovery query is
/// a whole-table scan; looping it per-artist would repeat that scan for every artist tidied).
pub async fn run_repair(
    pool: &PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &Reporter,
    scope: Option<&[String]>,
) -> Result<BoxSetSummary, sqlx::Error> {
    let groups = find_sibling_groups(pool, scope).await?;
    let mut summary = BoxSetSummary::default();
    // A group under two siblings can never bind, so it is reported separately rather than padding
    // `groups_seen` - the denominator has to mean "groups that had a chance".
    summary.groups_under_two_siblings = groups.iter().filter(|g| g.rows.len() < 2).count();
    summary.groups_seen = groups.len() - summary.groups_under_two_siblings;
    reporter.info(&format!(
        "{} sibling-folder group(s) not folded by tier 1",
        summary.groups_seen
    ));
    reporter.blank();

    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let total = groups.len();
    let mut bound: Vec<(BoxBindPlan, String)> = Vec::new();

    for (idx, group) in groups.into_iter().enumerate() {
        if group.rows.len() < 2 {
            continue;
        }
        reporter.item("Group", &group.parent, idx + 1, total);
        reporter.sub_step(&format!("{} sibling folder(s):", group.rows.len()));
        for r in &group.rows {
            reporter.sub_step(&format!(
                "  [{}] embedded id: {}",
                r.folder_path,
                r.unanimous_mb_release_id.as_deref().unwrap_or("(none)")
            ));
        }

        let mut siblings: Vec<BoxSibling> = Vec::with_capacity(group.rows.len());
        let mut read_failed = false;
        for row in &group.rows {
            match sibling_tracks(pool, &row.local_id).await {
                Ok(tracks) => siblings.push(BoxSibling {
                    local_id: row.local_id.clone(),
                    folder_path: row.folder_path.clone(),
                    tracks,
                }),
                Err(e) => {
                    let msg = format!("box group [{}]: reading tracks failed: {}", group.parent, e);
                    reporter.warn(&msg);
                    common::error_log::log_warn(&msg);
                    summary.groups_failed += 1;
                    read_failed = true;
                    break;
                }
            }
        }
        if read_failed {
            continue;
        }

        let local_ids: Vec<String> = group.rows.iter().map(|r| r.local_id.clone()).collect();
        let Some((artist_id, artist_name)) = artist_for_group(pool, &local_ids).await else {
            summary.groups_skipped_no_artist += 1;
            reporter.skip("no artist link found for this group - skipped");
            continue;
        };

        let mut embedded_ids: std::collections::BTreeSet<String> = group
            .rows
            .iter()
            .filter_map(|r| r.unanimous_mb_release_id.clone())
            .collect();
        embedded_ids.extend(bound_box_mb_ids(pool, &local_ids).await);
        let embedded_ids: Vec<String> = embedded_ids.into_iter().collect();

        // Tier (d) first, and it costs nothing: a group whose siblings are all already placed can be
        // rebuilt from the rows the box already has, so the common "nothing to discover here" case
        // never reaches MusicBrainz at all (docs/sync_decisions.md §19 item 3).
        let all_placed = group.rows.iter().all(|r| r.placed);
        let mut fetched = CandidateFetch::default();
        if all_placed || group.nested {
            fetched.candidates = candidates_from_db(pool, &embedded_ids).await;
            if !fetched.candidates.is_empty() {
                reporter.sub_step(&format!(
                    "tier (d): {} candidate(s) rebuilt from the database, no MusicBrainz call",
                    fetched.candidates.len()
                ));
                summary.groups_from_db += 1;
            }
        }
        if fetched.candidates.is_empty() {
            fetched = candidates_from_embedded_ids(http_client, limiter, &embedded_ids, reporter).await;
        }
        if fetched.candidates.is_empty() {
            let title = guess_box_title(&group.parent);
            let searched =
                candidates_from_search(http_client, limiter, &title, &artist_name, reporter).await;
            fetched.errors += searched.errors;
            fetched.candidates = searched.candidates;
        }

        if fetched.candidates.is_empty() {
            if fetched.errors > 0 {
                // Not a settled negative: MusicBrainz was unwell. Withhold this artist's watermark so
                // the next run asks again instead of never revisiting the group.
                summary.candidate_fetch_errors += fetched.errors;
                summary.artists_with_fetch_errors.insert(artist_id.clone());
                reporter.skip("no candidate found - MusicBrainz lookups failed, will retry");
            } else {
                summary.groups_no_candidate += 1;
                reporter.skip("no multi-medium candidate found");
            }
            continue;
        }

        let mut refusals: Vec<(String, BindRefusal)> = Vec::new();
        let mut plan = None;
        for f in &fetched.candidates {
            match plan_box_bind_detailed(&siblings, &f.candidate) {
                Ok(p) => {
                    plan = Some((f, p));
                    break;
                }
                Err(refusal) => refusals.push((f.title.clone(), refusal)),
            }
        }

        // Tier (c): the bound candidate may simply be the wrong *edition* of the right box - MB
        // catalogues several, and the ordinary album matcher picked one. Try the group's other
        // editions before giving up (docs/sync_decisions.md §19 item 1a).
        let mut other_editions: Vec<FetchedCandidate> = Vec::new();
        if plan.is_none() {
            let already_tried: HashSet<String> = fetched
                .candidates
                .iter()
                .map(|f| f.candidate.release_id.clone())
                .collect();
            let mut rg_seen: HashSet<String> = HashSet::new();
            for f in &fetched.candidates {
                if let CandidateSource::Fetched {
                    rg_id,
                    primary_type,
                    ..
                } = &f.source
                {
                    if rg_seen.insert(rg_id.clone()) {
                        reporter.sub_step(&format!(
                            "tier (c): trying other editions of release group {rg_id}..."
                        ));
                        let more = candidates_from_release_group(
                            http_client,
                            limiter,
                            rg_id,
                            primary_type.as_deref(),
                            &already_tried,
                            reporter,
                        )
                        .await;
                        fetched.errors += more.errors;
                        other_editions.extend(more.candidates);
                    }
                }
            }
            for f in &other_editions {
                match plan_box_bind_detailed(&siblings, &f.candidate) {
                    Ok(p) => {
                        plan = Some((f, p));
                        break;
                    }
                    Err(refusal) => refusals.push((f.title.clone(), refusal)),
                }
            }
            if plan.is_none() {
                report_refusals(&mut summary, reporter, &refusals);
                if fetched.errors > 0 {
                    summary.candidate_fetch_errors += fetched.errors;
                    summary.artists_with_fetch_errors.insert(artist_id.clone());
                }
                continue;
            }
        }

        let Some((fetched_candidate, plan)) = plan else {
            report_refusals(&mut summary, reporter, &refusals);
            continue;
        };

        println!(
            "{} {} -> {} ({} sibling(s) matched, {}/{} discs owned)",
            "▸".cyan(),
            plan.release_id,
            plan.folder_path,
            plan.members.len(),
            plan.members.len(),
            fetched_candidate.candidate.media.len(),
        );
        for s in &siblings {
            let owned = plan.members.iter().any(|(id, _)| id == &s.local_id);
            let mark = if owned {
                "OWN  ".green().bold()
            } else {
                "skip ".yellow()
            };
            println!("    {} {} [{}]", mark, s.local_id, s.folder_path);
        }

        let mb_db_id = match &fetched_candidate.source {
            // Already in the database, rebuilt by tier (d) - nothing to persist. Re-link the tracks
            // anyway so the outcome is identical to the fetched path.
            CandidateSource::Stored { mb_db_id } => {
                if let Err(e) = relink_stored_tracks(pool, mb_db_id, &plan).await {
                    let msg = format!("box group [{}]: relinking failed: {}", plan.folder_path, e);
                    reporter.warn(&msg);
                    common::error_log::log_warn(&msg);
                    summary.groups_failed += 1;
                    continue;
                }
                mb_db_id.clone()
            }
            CandidateSource::Fetched {
                release,
                rg_id,
                primary_type,
            } => {
                let artist_genre_ids = get_artist_genre_ids(pool, &artist_id).await;
                match persist_box_media(
                    pool,
                    release,
                    rg_id,
                    primary_type.as_deref(),
                    &fetched_candidate.candidate,
                    &plan,
                    &mut release_type_cache,
                    &artist_id,
                    &artist_genre_ids,
                )
                .await
                {
                    Ok(id) => id,
                    Err(e) => {
                        let msg =
                            format!("box group [{}]: binding failed: {}", plan.folder_path, e);
                        reporter.warn(&msg);
                        common::error_log::log_warn(&msg);
                        summary.groups_failed += 1;
                        continue;
                    }
                }
            }
        };

        summary.groups_bound += 1;
        summary.rows_absorbed += plan.absorbed.len();
        bound.push((plan, mb_db_id));
    }

    if bound.is_empty() {
        return Ok(summary);
    }

    reporter.blank();
    reporter.header("Deriving box-set equivalences");
    box_editions::run_link_box_editions(pool, reporter).await?;

    reporter.blank();
    reporter.header("Fold vs dissolve");
    for (plan, mb_db_id) in &bound {
        let equivalents = match count_equivalents(pool, mb_db_id).await {
            Ok(n) => n,
            Err(e) => {
                let msg = format!(
                    "box group [{}]: counting equivalents failed: {}",
                    plan.folder_path, e
                );
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                summary.groups_failed += 1;
                continue;
            }
        };
        let outcome = match decide_outcome(equivalents) {
            BoxOutcome::Fold => apply_fold(pool, plan, mb_db_id).await.map(|folded| {
                if let Some(survivor) = folded {
                    summary.touched_local_release_ids.push(survivor);
                    "fold"
                } else {
                    "key-taken"
                }
            }),
            BoxOutcome::Dissolve => apply_dissolve(pool, plan, mb_db_id).await.map(|changed| {
                summary.touched_local_release_ids.extend(changed);
                "dissolve"
            }),
        };
        match outcome {
            Ok("key-taken") => {
                summary.groups_key_taken += 1;
                reporter.skip(&format!(
                    "{}: box root folder is already its own release - left as is",
                    plan.folder_path
                ));
            }
            Ok(label) => {
                if label == "fold" {
                    summary.groups_folded += 1;
                } else {
                    summary.groups_dissolved += 1;
                }
                println!(
                    "{} {} -> {} ({} equivalent medium/media)",
                    "▸".cyan(),
                    plan.folder_path,
                    label,
                    equivalents
                );
            }
            Err(e) => {
                let msg = format!(
                    "box group [{}]: fold/dissolve failed: {}",
                    plan.folder_path, e
                );
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                summary.groups_failed += 1;
            }
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

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
                ("l3", "Three Boats Down From the Candy (re-record)", Some(242)),
                ("l4", "Market Square Heroes (alternative version)", Some(288)),
            ],
        );
        let m = medium(
            4,
            &[
                ("m1", "Punch and Judy", Some(200)),
                ("m2", "Market Square Heroes (re-record edit)", Some(240)),
                ("m3", "Three Boats Down From the Candy (re-record)", Some(242)),
                ("m4", "Market Square Heroes (re-record)", Some(288)),
            ],
        );
        let by_local: std::collections::HashMap<_, _> = pair_tracks(&local.tracks, &m.tracks)
            .expect("a differing qualifier must not reject the disc")
            .into_iter()
            .collect();
        assert_eq!(by_local["l4"], "m4");
        assert_eq!(by_local["l2"], "m2", "the exact pair is still claimed first");
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
        (
            Some(disc),
            mb_id.map(str::to_string),
            title.to_string(),
            ms,
        )
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
            sibling("root", "Clutch/Album/2004 - Blast Tyrant", &[("t1", "Mercury", Some(60)), ("t2", "Profits of Doom", Some(250))]),
            sibling("cd2", "Clutch/Album/2004 - Blast Tyrant/CD 2 - Bonus Disc", &[("t3", "Drink to the Dead", Some(200)), ("t4", "Cypress Grove", Some(210))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb".to_string(),
            media: vec![
                medium(1, &[("m1", "Mercury", Some(60)), ("m2", "Profits of Doom", Some(250))]),
                medium(2, &[("m3", "Drink to the Dead", Some(200)), ("m4", "Cypress Grove", Some(210))]),
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
                nested("A", vec![row("a", "A"), row("ab", "A/B"), row("abc", "A/B/C")]),
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
        assert_eq!(strip_qualifier("Market Square Heroes (re-record)"), "Market Square Heroes");
        assert_eq!(strip_qualifier("Song (live) [remastered]"), "Song");
        assert_eq!(strip_qualifier("Plain Title"), "Plain Title");
        // A bracket that is not trailing is part of the title.
        assert_eq!(strip_qualifier("(I Can't Get No) Satisfaction"), "(I Can't Get No) Satisfaction");
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
        assert_eq!(by_local["cd1"], 2, "the exact mastering, not the 40s-out one");
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
        assert!(!bound.contains(&"dvd"), "the unmatched folder must not be bound");
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
        let discs: &[(i32, &[(&str, i32, i32)])] = &[
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
}
