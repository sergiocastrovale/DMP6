mod corrupted;
mod duplicates;
mod enrichment;
mod missing;
mod orphans;
mod release_pairs;

use clap::Parser;
use common::{
    config::{apply_db_overrides, load_config},
    db::create_pool_or_exit,
    progress::Reporter,
};
use serde_json::json;
use sqlx::PgPool;

/// Runs one detector, reports what it found (or its error), and folds the result into `counts`/
/// `had_error` - the 7 detectors below are otherwise identical boilerplate around a differently-named
/// `detect(&pool, &run_id)` call.
async fn run_detector<F>(
    reporter: &Reporter,
    label: &str,
    key: &str,
    counts: &mut serde_json::Map<String, serde_json::Value>,
    had_error: &mut bool,
    fut: F,
) where
    F: std::future::Future<Output = Result<usize, sqlx::Error>>,
{
    reporter.step(label);
    match fut.await {
        Ok(n) => {
            reporter.nested().ok(&format!("{n} found"));
            counts.insert(key.into(), json!(n));
        }
        Err(e) => {
            reporter.nested().warn(&format!("{e}"));
            counts.insert(key.into(), json!(0));
            *had_error = true;
        }
    }
}

#[derive(Parser, Debug)]
#[command(
    name = "audit",
    about = "Detect metadata issues and persist them in the DB"
)]
struct Args {
    /// Only run corrupted TPE2 detection
    #[arg(long)]
    corrupted: bool,
    /// Only run orphan artist detection
    #[arg(long)]
    orphans: bool,
    /// Only run duplicate artist detection
    #[arg(long)]
    duplicates: bool,
    /// Only run missing metadata detection
    #[arg(long)]
    missing: bool,
    /// Only run enrichment gap detection (BPM, mood, acousticId, MB link, Discogs, Bandcamp, Wikipedia)
    #[arg(long)]
    enrichment: bool,
    /// Only run duplicate-release detection (same MB releaseId, same title/tracks/duration)
    #[arg(long = "duplicate-release")]
    duplicate_release: bool,
    /// Only run mismatched-release-id detection (same MB releaseId, different titles)
    #[arg(long = "mismatched-release-id")]
    mismatched_release_id: bool,
}

impl Args {
    fn run_all(&self) -> bool {
        !self.corrupted
            && !self.orphans
            && !self.duplicates
            && !self.missing
            && !self.enrichment
            && !self.duplicate_release
            && !self.mismatched_release_id
    }
    fn should_run_corrupted(&self) -> bool {
        self.run_all() || self.corrupted
    }
    fn should_run_orphans(&self) -> bool {
        self.run_all() || self.orphans
    }
    fn should_run_duplicates(&self) -> bool {
        self.run_all() || self.duplicates
    }
    fn should_run_missing(&self) -> bool {
        self.run_all() || self.missing
    }
    fn should_run_enrichment(&self) -> bool {
        self.run_all() || self.enrichment
    }
    fn should_run_duplicate_release(&self) -> bool {
        self.run_all() || self.duplicate_release
    }
    fn should_run_mismatched_release_id(&self) -> bool {
        self.run_all() || self.mismatched_release_id
    }
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    common::error_log::init("audit");
    let reporter = Reporter::new(false);
    let mut config = load_config(None);
    let pool = create_pool_or_exit(&config.database_url, "audit").await;
    apply_db_overrides(&mut config, &pool).await;

    reporter.header("DMP Audit");
    reporter.blank();

    let run_id = create_audit_run(&pool).await;
    let mut counts = serde_json::Map::new();
    let mut had_error = false;

    if args.should_run_corrupted() {
        run_detector(
            &reporter,
            "Detecting corrupted TPE2...",
            "corrupted",
            &mut counts,
            &mut had_error,
            corrupted::detect(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_orphans() {
        run_detector(
            &reporter,
            "Detecting orphan artists...",
            "orphans",
            &mut counts,
            &mut had_error,
            orphans::detect(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_duplicates() {
        run_detector(
            &reporter,
            "Detecting duplicate artists...",
            "duplicates",
            &mut counts,
            &mut had_error,
            duplicates::detect(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_missing() {
        run_detector(
            &reporter,
            "Detecting missing metadata...",
            "missing",
            &mut counts,
            &mut had_error,
            missing::detect(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_enrichment() {
        run_detector(
            &reporter,
            "Detecting enrichment gaps...",
            "enrichment",
            &mut counts,
            &mut had_error,
            enrichment::detect(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_duplicate_release() {
        run_detector(
            &reporter,
            "Detecting duplicate releases...",
            "duplicate-release",
            &mut counts,
            &mut had_error,
            release_pairs::detect_duplicate_release(&pool, &run_id),
        )
        .await;
    }

    if args.should_run_mismatched_release_id() {
        run_detector(
            &reporter,
            "Detecting mismatched release IDs...",
            "mismatched-release-id",
            &mut counts,
            &mut had_error,
            release_pairs::detect_mismatched_release_id(&pool, &run_id),
        )
        .await;
    }

    finish_audit_run(&pool, &run_id, serde_json::Value::Object(counts)).await;
    reporter.blank();
    if had_error {
        reporter.failed("Audit finished with errors - see above.");
        std::process::exit(1);
    }
    reporter.done("Audit complete.");
}

async fn create_audit_run(pool: &PgPool) -> String {
    let id = cuid2::create_id();
    let now = chrono::Utc::now().naive_utc();
    sqlx::query(r#"INSERT INTO "AuditRun" (id, "startedAt", "createdAt") VALUES ($1, $2, $2)"#)
        .bind(&id)
        .bind(now)
        .execute(pool)
        .await
        .expect("Failed to create AuditRun");
    id
}

async fn finish_audit_run(pool: &PgPool, run_id: &str, counts: serde_json::Value) {
    let now = chrono::Utc::now().naive_utc();
    sqlx::query(r#"UPDATE "AuditRun" SET "finishedAt" = $1, counts = $2 WHERE id = $3"#)
        .bind(now)
        .bind(counts)
        .bind(run_id)
        .execute(pool)
        .await
        .expect("Failed to finish AuditRun");
}
