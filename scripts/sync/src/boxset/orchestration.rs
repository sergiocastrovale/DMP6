use super::*;
use std::collections::{HashMap, HashSet};

use crate::box_editions;
use crate::db::*;
use crate::mb_api::RateLimiter;
use colored::Colorize;
use common::progress::Reporter;
use reqwest::Client;
use sqlx::PgPool;

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

    // -- Why the rest were not bound. Every unbound group must be accounted for in one of the fields
    // -- below, so `groups_seen` minus `groups_bound` is never a number with no explanation - an
    // -- unaccounted gap is exactly where a MusicBrainz outage could hide for a whole rollout.
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
            fetched =
                candidates_from_embedded_ids(http_client, limiter, &embedded_ids, reporter).await;
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

        reporter.info(&format!(
            "{} {} -> {} ({} sibling(s) matched, {}/{} discs owned)",
            "▸".cyan(),
            plan.release_id,
            plan.folder_path,
            plan.members.len(),
            plan.members.len(),
            fetched_candidate.candidate.media.len(),
        ));
        for s in &siblings {
            let owned = plan.members.iter().any(|(id, _)| id == &s.local_id);
            let mark = if owned {
                "OWN  ".green().bold()
            } else {
                "skip ".yellow()
            };
            reporter.info(&format!("    {} {} [{}]", mark, s.local_id, s.folder_path));
        }

        let mb_db_id = match &fetched_candidate.source {
            // Already in the database, rebuilt by tier (d) - nothing to persist. Re-link the tracks
            // anyway so the outcome is identical to the fetched path.
            CandidateSource::Stored { mb_db_id } => {
                if let Err(e) = relink_stored_tracks(pool, mb_db_id, &plan).await {
                    let msg = format!("box group [{}]: relinking failed: {}", plan.folder_path, e);
                    reporter.warn(&msg);
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
                reporter.info(&format!(
                    "{} {} -> {} ({} equivalent medium/media)",
                    "▸".cyan(),
                    plan.folder_path,
                    label,
                    equivalents
                ));
            }
            Err(e) => {
                let msg = format!(
                    "box group [{}]: fold/dissolve failed: {}",
                    plan.folder_path, e
                );
                reporter.warn(&msg);
                summary.groups_failed += 1;
            }
        }
    }

    Ok(summary)
}
