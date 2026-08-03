mod corrupted;
mod duplicates;
mod enrichment;
mod missing;
mod orphans;
mod release_pairs;

use clap::Parser;
use colored::Colorize;
use common::{
    config::{apply_db_overrides, load_config},
    db::create_pool,
};
use serde_json::json;
use sqlx::PgPool;

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
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    println!("{}", "audit starting...".bold());

    let run_id = create_audit_run(&pool).await;
    let mut counts = serde_json::Map::new();

    if args.should_run_corrupted() {
        print!("{} ", "→ Detecting corrupted TPE2...".cyan());
        match corrupted::detect(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("corrupted".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("corrupted".into(), json!(0));
            }
        }
    }

    if args.should_run_orphans() {
        print!("{} ", "→ Detecting orphan artists...".cyan());
        match orphans::detect(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("orphans".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("orphans".into(), json!(0));
            }
        }
    }

    if args.should_run_duplicates() {
        print!("{} ", "→ Detecting duplicate artists...".cyan());
        match duplicates::detect(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("duplicates".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("duplicates".into(), json!(0));
            }
        }
    }

    if args.should_run_missing() {
        print!("{} ", "→ Detecting missing metadata...".cyan());
        match missing::detect(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("missing".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("missing".into(), json!(0));
            }
        }
    }

    if args.should_run_enrichment() {
        print!("{} ", "→ Detecting enrichment gaps...".cyan());
        match enrichment::detect(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("enrichment".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("enrichment".into(), json!(0));
            }
        }
    }

    if args.should_run_duplicate_release() {
        print!("{} ", "→ Detecting duplicate releases...".cyan());
        match release_pairs::detect_duplicate_release(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("duplicate-release".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("duplicate-release".into(), json!(0));
            }
        }
    }

    if args.should_run_mismatched_release_id() {
        print!("{} ", "→ Detecting mismatched release IDs...".cyan());
        match release_pairs::detect_mismatched_release_id(&pool, &run_id).await {
            Ok(n) => {
                println!("{} found", n.to_string().yellow());
                counts.insert("mismatched-release-id".into(), json!(n));
            }
            Err(e) => {
                println!("{}: {}", "ERROR".red(), e);
                counts.insert("mismatched-release-id".into(), json!(0));
            }
        }
    }

    finish_audit_run(&pool, &run_id, serde_json::Value::Object(counts)).await;
    println!("{}", "Audit complete.".green().bold());
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
