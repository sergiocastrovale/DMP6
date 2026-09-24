use chrono::Utc;
use clap::Parser;
use common::config::{apply_db_overrides, load_config};
use common::db::create_pool_or_exit;
use common::filters::matches_filter;
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use common::progress::Reporter;
use common::statistics::update_statistics;
use dmp_sync::boxset;
use dmp_sync::db::{
    self, delete_empty_local_releases, delete_orphaned_mb_releases,
    retire_owned_missing_placeholders, RescoreOutcome,
};
use dmp_sync::mb_api::RateLimiter;
use reqwest::Client;
use std::collections::HashSet;
use std::sync::atomic::Ordering;

/// Library-wide repair split out of `./sync` (docs/scripts/tidy.md, docs/specs/spec_tidy_script.md).
/// Every caller chains `./tidy` after `./sync` - sync itself never calls it.
#[derive(Parser, Debug)]
#[command(name = "tidy")]
struct TidyArgs {
    #[arg(
        long,
        help = "Ignore the lastTidiedAt watermark - process every synced artist"
    )]
    all: bool,
    #[arg(long, short, help = "Only tidy these artists (semicolon-separated)")]
    only: Option<String>,
    #[arg(long, help = "Exact match for --only (no prefix matching)")]
    exact: bool,
    #[arg(long, short)]
    from: Option<String>,
    #[arg(long, short)]
    to: Option<String>,
    #[arg(
        long,
        help = "Read artist IDs from file (one per line, used by refresh) - bypasses the watermark and --only/--from/--to"
    )]
    artist_ids: Option<String>,
    #[arg(long)]
    verbose: bool,
    /// Emit PROGRESS:{json} lines and plain output for the web terminal.
    #[arg(long)]
    web: bool,
    /// Re-score bound releases - including ones already `MISSING_TRACKS` - against the release on file,
    /// and do nothing else: no box pass, no cleanup, no identity repair, no MusicBrainz calls, and no
    /// watermark stamp (the box pass did not run, so the artists are not "tidied"). For applying an
    /// improvement to the scorer's own rules to releases that were scored before it existed.
    #[arg(long)]
    rescore_only: bool,
}

#[derive(Default)]
struct TidySummary {
    empty_local_releases_removed: u64,
    orphans_retired_round1: u64,
    placeholders_retired_round1: u64,
    box_groups_seen: usize,
    box_groups_bound: usize,
    box_groups_folded: usize,
    box_groups_dissolved: usize,
    box_groups_key_taken: usize,
    box_groups_failed: usize,
    /// Why the groups that were seen but not bound were not bound - see
    /// `dmp_sync::boxset::BoxSetSummary::refusal_breakdown`.
    box_refusal_breakdown: String,
    box_groups_from_db: usize,
    /// Artists whose watermark is deliberately withheld because a MusicBrainz lookup failed on one of
    /// their groups. They stay pending so the next run retries them.
    artists_held_for_retry: usize,
    /// Releases whose medium rows and `mediumCount` were rebuilt from their tracks' disc numbers
    /// (`db::backfill_media_from_track_discs`).
    media_backfilled: u64,
    orphans_retired_round2: u64,
    placeholders_retired_round2: u64,
    rescored_complete: usize,
    rescored_incomplete: usize,
    rescored_extra_tracks: usize,
    rescored_missing_tracks: usize,
    rescored_other: usize,
    rescore_deferred: usize,
    /// Of those re-scored, how many were picked up only because their tracks linked outside their own
    /// release (`RescoreTarget::stale_links_only`).
    rescored_stale_links: usize,
    /// Of those re-scored, how many were stored `MISSING_TRACKS` and now score `COMPLETE` - a scorer
    /// improvement reaching an already-scored release (`--rescore-only`'s whole point).
    rescored_missing_now_complete: usize,
    identity_pass_a: usize,
    identity_pass_b: usize,
    identity_pass_c: usize,
    completeness_recomputed: u64,
    artists_stamped: usize,
}

#[tokio::main]
async fn main() {
    let args = TidyArgs::parse();
    common::error_log::init("tidy");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool_or_exit(&config.database_url, "tidy").await;
    apply_db_overrides(&mut config, &pool).await;

    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let _lock_guard = match acquire_lock(&pool, "tidy", pid).await {
        Ok(g) => g,
        Err(e) => {
            reporter.err(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let running = common::app::spawn_shutdown_handlers(&pool, "tidy", "phase", 1);

    reporter.header(if args.web {
        "DMP Tidy"
    } else {
        "DMP Tidy - Library Repair"
    });
    let start = Utc::now().naive_utc();
    let start_time = std::time::Instant::now();
    let mut had_error = false;
    let mut summary = TidySummary::default();

    // ---- Phase 1: scope ----
    // A failure here (bad --artist-ids path, or the DB read itself) must never read as "0 artists in
    // scope" - that renders as "Nothing to tidy" and exits 0, indistinguishable from a genuinely
    // empty, successful run.
    let scope_ids: Vec<String> = if let Some(path) = &args.artist_ids {
        match std::fs::read_to_string(path) {
            Ok(contents) => contents
                .lines()
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect(),
            Err(e) => {
                let msg = format!("Failed to read artist IDs file '{}': {}", path, e);
                reporter.err(&msg);
                release_lock(&pool, "tidy", std::process::id()).await;
                std::process::exit(1);
            }
        }
    } else {
        let loaded = if args.all {
            db::get_all_synced_artists(&pool).await
        } else {
            db::get_artists_pending_tidy(&pool).await
        };
        let base: Vec<(String, String)> = match loaded {
            Ok(rows) => rows,
            Err(e) => {
                reporter.err(&format!("Failed to load tidy scope: {}", e));
                release_lock(&pool, "tidy", std::process::id()).await;
                std::process::exit(1);
            }
        };
        let narrow = args.only.is_some() || args.from.is_some() || args.to.is_some();
        base.into_iter()
            .filter(|(_, name)| {
                !narrow
                    || matches_filter(
                        name,
                        args.from.as_deref().unwrap_or(""),
                        args.to.as_deref().unwrap_or(""),
                        args.only.as_deref().unwrap_or(""),
                        args.exact,
                    )
            })
            .map(|(id, _)| id)
            .collect()
    };

    if scope_ids.is_empty() {
        reporter.done("Nothing to tidy.");
        release_lock(&pool, "tidy", std::process::id()).await;
        return;
    }

    // Whole-library semantics: only a plain `--all` (no further narrowing) counts as truly global -
    // unscoped queries can catch ownerless rows a scoped one deliberately leaves for this pass.
    let is_global = args.all
        && args.only.is_none()
        && args.from.is_none()
        && args.to.is_none()
        && args.artist_ids.is_none();
    let scope: Option<&[String]> = if is_global { None } else { Some(&scope_ids) };

    reporter.info(&format!("{} artist(s) in scope", scope_ids.len()));
    reporter.blank();

    let mut touched_ids: Vec<String> = Vec::new();
    let mut held_for_retry: HashSet<String> = HashSet::new();

    if args.rescore_only {
        reporter.info("Re-score only: box pass, cleanup and identity repair skipped.");
    } else {
        // ---- Phase 2: empty local releases ----
        match delete_empty_local_releases(&pool, scope).await {
            Ok(n) => {
                summary.empty_local_releases_removed = n;
                if n > 0 {
                    reporter.info(&format!("Cleaned up {} empty local release(s)", n));
                }
            }
            Err(e) => {
                let msg = format!("delete_empty_local_releases failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }

        // ---- Phase 3: orphans + retire (round 1) - order mandatory, see db::retire_owned_missing_placeholders ----
        match delete_orphaned_mb_releases(&pool, scope).await {
            Ok(n) => {
                summary.orphans_retired_round1 = n;
                if n > 0 {
                    reporter.info(&format!("Cleaned up {} orphaned MB release(s)", n));
                }
            }
            Err(e) => {
                let msg = format!("delete_orphaned_mb_releases (round 1) failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        match retire_owned_missing_placeholders(&pool).await {
            Ok(n) => {
                summary.placeholders_retired_round1 = n;
                if n > 0 {
                    reporter.info(&format!("Retired {} owned MISSING placeholder(s)", n));
                }
            }
            Err(e) => {
                let msg = format!("retire_owned_missing_placeholders (round 1) failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }

        // ---- Phase 3b: medium backfill - before the box pass, which keys everything off mediumCount > 1 ----
        match db::backfill_media_from_track_discs(&pool).await {
            Ok(n) => {
                summary.media_backfilled = n;
                if n > 0 {
                    reporter.info(&format!(
                        "Rebuilt disc structure for {} release(s) stored before discs were modelled",
                        n
                    ));
                }
            }
            Err(e) => {
                let msg = format!("backfill_media_from_track_discs failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }

        // ---- Phase 4: box pass ----
        if running.load(Ordering::SeqCst) {
            let http_client = Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("HTTP client");
            let mut limiter = RateLimiter::new();

            reporter.blank();
            reporter.header("Box sets");
            match boxset::run_repair(&pool, &http_client, &mut limiter, &reporter, scope).await {
                Ok(s) => {
                    summary.box_groups_seen = s.groups_seen;
                    summary.box_groups_bound = s.groups_bound;
                    summary.box_groups_folded = s.groups_folded;
                    summary.box_groups_dissolved = s.groups_dissolved;
                    summary.box_groups_key_taken = s.groups_key_taken;
                    summary.box_groups_failed = s.groups_failed;
                    summary.box_refusal_breakdown = s.refusal_breakdown();
                    summary.box_groups_from_db = s.groups_from_db;
                    if s.groups_failed > 0 {
                        had_error = true;
                    }
                    // A group skipped because MusicBrainz was unwell is not a settled answer. Withhold just
                    // those artists' watermark rather than failing the whole run - marking `had_error` here
                    // would unstamp every artist in scope and redo the entire library over one 503.
                    held_for_retry = s.artists_with_fetch_errors;
                    touched_ids = s.touched_local_release_ids;
                }
                Err(e) => {
                    let msg = format!("boxset::run_repair failed: {}", e);
                    reporter.warn(&msg);
                    common::error_log::log_warn(&msg);
                    had_error = true;
                }
            }
        }

        // ---- Phase 6: orphans + retire (round 2) - dissolving makes release groups owned ----
        match delete_orphaned_mb_releases(&pool, scope).await {
            Ok(n) => {
                summary.orphans_retired_round2 = n;
                if n > 0 {
                    reporter.info(&format!(
                        "Cleaned up {} orphaned MB release(s) after box repair",
                        n
                    ));
                }
            }
            Err(e) => {
                let msg = format!("delete_orphaned_mb_releases (round 2) failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        match retire_owned_missing_placeholders(&pool).await {
            Ok(n) => {
                summary.placeholders_retired_round2 = n;
                if n > 0 {
                    reporter.info(&format!(
                        "Retired {} MISSING placeholder(s) covered by a dissolved box",
                        n
                    ));
                }
            }
            Err(e) => {
                let msg = format!("retire_owned_missing_placeholders (round 2) failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
    }

    // ---- Phase 5: DB-only re-score ----
    reporter.blank();
    reporter.header("Re-score");
    match db::get_rescore_targets(&pool, scope, &touched_ids, args.rescore_only).await {
        Ok(targets) => {
            let total = targets.len();
            for (idx, target) in targets.iter().enumerate() {
                reporter.tidy_progress("Re-scoring", idx + 1, total);
                if args.verbose {
                    reporter.item("Release", &target.local_release_id, idx + 1, total);
                }
                match db::rescore_bound_release(&pool, target).await {
                    Ok(RescoreOutcome::Scored(status)) => {
                        if target.stale_links_only {
                            summary.rescored_stale_links += 1;
                        }
                        if target.was_missing_tracks && status == "COMPLETE" {
                            summary.rescored_missing_now_complete += 1;
                        }
                        match status {
                            "COMPLETE" => summary.rescored_complete += 1,
                            "INCOMPLETE" => summary.rescored_incomplete += 1,
                            "EXTRA_TRACKS" => summary.rescored_extra_tracks += 1,
                            "MISSING_TRACKS" => summary.rescored_missing_tracks += 1,
                            _ => summary.rescored_other += 1,
                        }
                    }
                    Ok(RescoreOutcome::Deferred) => summary.rescore_deferred += 1,
                    Err(e) => {
                        let msg = format!(
                            "rescore_bound_release({}) failed: {}",
                            target.local_release_id, e
                        );
                        reporter.warn(&msg);
                        common::error_log::log_warn(&msg);
                        had_error = true;
                    }
                }
            }
            reporter.done(&format!(
                "{} release(s) re-scored, {} deferred",
                summary.rescored_complete
                    + summary.rescored_incomplete
                    + summary.rescored_extra_tracks
                    + summary.rescored_missing_tracks
                    + summary.rescored_other,
                summary.rescore_deferred
            ));
        }
        Err(e) => {
            let msg = format!("get_rescore_targets failed: {}", e);
            reporter.warn(&msg);
            common::error_log::log_warn(&msg);
            had_error = true;
        }
    }

    if !args.rescore_only {
        // ---- Phase 7: artist identity repair (global, pure SQL) ----
        reporter.blank();
        reporter.header("Artist identities");
        match db::repair_all_empty_primaries(&pool, false).await {
            Ok(done) => {
                summary.identity_pass_a = done.len();
                for r in &done {
                    reporter.ok(&format!(
                        "{} ({} release(s)) vs \"{}\" - {}",
                        r.artist, r.releases, r.other, r.action
                    ));
                }
            }
            Err(e) => {
                let msg = format!("repair_all_empty_primaries failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        match db::repair_contradicted_identities(&pool, false).await {
            Ok(done) => {
                summary.identity_pass_b = done.len();
                for r in &done {
                    reporter.ok(&format!(
                        "{} ({} release(s)) - independent lookup contradicts {}",
                        r.artist, r.releases, r.cleared_mbid
                    ));
                }
            }
            Err(e) => {
                let msg = format!("repair_contradicted_identities failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        match db::repair_shared_identities(&pool, false).await {
            Ok(done) => {
                summary.identity_pass_c = done.len();
                for g in &done {
                    match &g.kept {
                        Some(name) => reporter.ok(&format!(
                            "{} kept by \"{}\", cleared from: {}",
                            g.mbid,
                            name,
                            g.cleared.join(", ")
                        )),
                        None => reporter.ok(&format!(
                            "{} - no member confirmed, cleared from all: {}",
                            g.mbid,
                            g.cleared.join(", ")
                        )),
                    }
                }
            }
            Err(e) => {
                let msg = format!("repair_shared_identities failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        reporter.done(&format!(
            "Pass A: {}, Pass B: {}, Pass C: {}",
            summary.identity_pass_a, summary.identity_pass_b, summary.identity_pass_c
        ));
    }

    // ---- Phase 8: completeness ----
    reporter.blank();
    if is_global {
        match db::recompute_all_completeness(&pool).await {
            Ok(n) => {
                summary.completeness_recomputed = n;
                reporter.done(&format!("Recomputed completeness ({} artist(s))", n));
            }
            Err(e) => {
                let msg = format!("recompute_all_completeness failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
    } else {
        let mut completeness_targets: HashSet<String> = scope_ids.iter().cloned().collect();
        match db::get_owner_artist_ids_for_releases(&pool, &touched_ids).await {
            Ok(owners) => completeness_targets.extend(owners),
            Err(e) => {
                let msg = format!("get_owner_artist_ids_for_releases failed: {}", e);
                reporter.warn(&msg);
                common::error_log::log_warn(&msg);
                had_error = true;
            }
        }
        let mut recomputed = 0u64;
        for artist_id in &completeness_targets {
            if common::totals::recompute_artist_completeness(&pool, artist_id)
                .await
                .is_ok()
            {
                recomputed += 1;
            }
        }
        summary.completeness_recomputed = recomputed;
        reporter.done(&format!(
            "Recomputed completeness ({} artist(s))",
            recomputed
        ));
    }

    // ---- Phase 9: statistics ----
    update_statistics(&pool).await.ok();

    // ---- Phase 10: watermark stamp ----
    // `--rescore-only` never stamps: the box pass did not run, so these artists have not been tidied.
    if running.load(Ordering::SeqCst) && !had_error && !args.rescore_only {
        // Everything in scope except the artists a failed MusicBrainz lookup left unanswered - those
        // stay pending on purpose, so the next `./tidy` asks again instead of treating an outage as a
        // settled "this group has no box" (docs/specs/spec_tidy_observations.md).
        let stampable: Vec<String> = scope_ids
            .iter()
            .filter(|id| !held_for_retry.contains(*id))
            .cloned()
            .collect();
        summary.artists_held_for_retry = scope_ids.len() - stampable.len();
        if is_global && held_for_retry.is_empty() {
            if db::stamp_all_tidied(&pool, start).await.is_ok() {
                summary.artists_stamped = stampable.len();
            }
        } else if db::stamp_artists_tidied(&pool, &stampable, start)
            .await
            .is_ok()
        {
            summary.artists_stamped = stampable.len();
        }
    }

    release_lock(&pool, "tidy", std::process::id()).await;

    let elapsed = start_time.elapsed();
    let h = elapsed.as_secs() / 3600;
    let m = (elapsed.as_secs() % 3600) / 60;
    let s = elapsed.as_secs() % 60;

    reporter.blank();
    reporter.info(&"═".repeat(60));
    reporter.blank();
    reporter.done(&format!("Tidy complete. ({}h:{:02}m:{:02}s)", h, m, s));
    reporter.kv("Elapsed", &format!("{:02}:{:02}:{:02}", h, m, s));
    reporter.kv(
        "Empty releases removed",
        &summary.empty_local_releases_removed.to_string(),
    );
    reporter.kv(
        "Orphans / placeholders",
        &format!(
            "{} / {} (round 1), {} / {} (round 2)",
            summary.orphans_retired_round1,
            summary.placeholders_retired_round1,
            summary.orphans_retired_round2,
            summary.placeholders_retired_round2
        ),
    );
    if summary.media_backfilled > 0 {
        reporter.kv(
            "Media backfilled",
            &format!("{} release(s)", summary.media_backfilled),
        );
    }
    reporter.kv(
        "Box groups",
        &format!(
            "{} seen, {} bound ({} folded, {} dissolved, {} key-taken, {} failed, {} from DB)",
            summary.box_groups_seen,
            summary.box_groups_bound,
            summary.box_groups_folded,
            summary.box_groups_dissolved,
            summary.box_groups_key_taken,
            summary.box_groups_failed,
            summary.box_groups_from_db
        ),
    );
    if !summary.box_refusal_breakdown.is_empty() {
        reporter.kv(
            "  not bound",
            &format!(
                "{} - {}",
                summary
                    .box_groups_seen
                    .saturating_sub(summary.box_groups_bound),
                summary.box_refusal_breakdown
            ),
        );
    }
    reporter.kv(
        "Re-scored",
        &format!(
            "{} complete, {} incomplete, {} extra tracks, {} missing tracks, {} other, {} deferred ({} for stale track links)",
            summary.rescored_complete,
            summary.rescored_incomplete,
            summary.rescored_extra_tracks,
            summary.rescored_missing_tracks,
            summary.rescored_other,
            summary.rescore_deferred,
            summary.rescored_stale_links
        ),
    );
    if summary.rescored_missing_now_complete > 0 {
        reporter.kv(
            "  was missing",
            &format!(
                "{} release(s) went from MISSING_TRACKS to COMPLETE",
                summary.rescored_missing_now_complete
            ),
        );
    }
    reporter.kv(
        "Identities",
        &format!(
            "Pass A: {}, Pass B: {}, Pass C: {}",
            summary.identity_pass_a, summary.identity_pass_b, summary.identity_pass_c
        ),
    );
    reporter.kv(
        "Completeness recomputed",
        &summary.completeness_recomputed.to_string(),
    );
    if args.rescore_only {
        reporter.kv(
            "Artists stamped",
            "none (re-score only - box pass did not run)",
        );
    } else if running.load(Ordering::SeqCst) && !had_error {
        reporter.kv(
            "Artists stamped",
            &format!(
                "{}{}",
                summary.artists_stamped,
                if summary.artists_held_for_retry > 0 {
                    format!(
                        " ({} held for retry - MusicBrainz lookups failed)",
                        summary.artists_held_for_retry
                    )
                } else {
                    String::new()
                }
            ),
        );
    } else {
        reporter.kv(
            "Artists stamped",
            &format!(
                "NOT stamped ({})",
                if had_error { "errors" } else { "interrupted" }
            ),
        );
    }
}
