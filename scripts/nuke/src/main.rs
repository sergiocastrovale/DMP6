use aws_sdk_s3::Client as S3Client;
use clap::Parser;
use common::{
    config::{apply_db_overrides, load_config},
    error_log,
    filters::matches_filter,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    progress::Reporter,
    s3::create_s3_client,
};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "nuke", about = "Delete all data from DMP database and images")]
struct Args {
    /// Skip confirmation prompt
    #[arg(long)]
    y: bool,

    /// Keep artist images (local files and S3 objects under artists/)
    #[arg(long)]
    keep_artist_img: bool,

    /// Delete only matching artist(s) - semicolon-separated, exact match
    #[arg(long)]
    only: Option<String>,

    /// Show what would be deleted without making any changes
    #[arg(long)]
    dry_run: bool,
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

async fn delete_s3_prefix(
    client: &S3Client,
    bucket: &str,
    prefix: &str,
    reporter: &Reporter,
) -> Result<usize, Box<dyn std::error::Error>> {
    use aws_sdk_s3::types::{Delete, ObjectIdentifier};

    let mut deleted_count = 0;
    let mut continuation_token: Option<String> = None;

    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .max_keys(1000);
        if let Some(ref token) = continuation_token {
            req = req.continuation_token(token);
        }
        let list = req.send().await?;

        let objects = list.contents.unwrap_or_default();
        if objects.is_empty() {
            break;
        }

        let identifiers: Vec<ObjectIdentifier> = objects
            .iter()
            .filter_map(|obj| {
                obj.key()
                    .and_then(|k| ObjectIdentifier::builder().key(k).build().ok())
            })
            .collect();

        let count = identifiers.len();
        if count > 0 {
            reporter.nested().info(&format!(
                "Deleting {} S3 objects from {}...",
                count,
                prefix.trim_end_matches('/')
            ));
            let delete = Delete::builder()
                .set_objects(Some(identifiers))
                .quiet(true)
                .build()?;
            client
                .delete_objects()
                .bucket(bucket)
                .delete(delete)
                .send()
                .await?;
            deleted_count += count;
        }

        if list.is_truncated.unwrap_or(false) {
            continuation_token = list.next_continuation_token;
        } else {
            break;
        }
    }

    Ok(deleted_count)
}

/// A connection string without its credentials, safe to print.
fn redact_url(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(scheme), Some(at)) if at > scheme => {
            format!("{}{}", &url[..scheme + 3], &url[at + 1..])
        }
        _ => url.to_string(),
    }
}

/// Artists whose name matches `only` exactly (`;`-separated), plus the duplicates connected to them.
async fn only_targets(pool: &PgPool, only: &str) -> Result<Vec<(String, String)>, sqlx::Error> {
    let all: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT id, name FROM "Artist" ORDER BY name"#)
            .fetch_all(pool)
            .await?;
    let mut targets: Vec<(String, String)> = all
        .into_iter()
        .filter(|(_, name)| matches_filter(name, "", "", only, true))
        .collect();
    let ids: Vec<String> = targets.iter().map(|(id, _)| id.clone()).collect();
    let connected: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, name FROM "Artist" WHERE "primaryArtistId" = ANY($1::text[])"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in connected {
        if !targets.iter().any(|(id, _)| *id == row.0) {
            targets.push(row);
        }
    }
    Ok(targets)
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    error_log::init("nuke");
    let reporter = Reporter::new(false);

    // NOTE: DB-configured S3/image overrides (Settings table) aren't applied until each branch below
    // opens its own pool - apply_db_overrides needs a live connection, and --only/full-wipe modes each
    // create their pool at a different point. `config` is `mut` so both branches can layer their
    // overrides on afterward.
    let mut config = load_config(None);

    // --only mode: selective artist deletion
    if let Some(ref only) = args.only {
        reporter.header("DMP Nuke --only");
        if args.dry_run {
            reporter.kv("Mode", "dry run");
        }
        reporter.blank();

        let pool = match PgPoolOptions::new()
            .max_connections(5)
            .connect(&config.database_url)
            .await
        {
            Ok(p) => p,
            Err(e) => {
                error_log::log_error(&format!("Failed to connect to database: {}", e));
                reporter.failed(&format!("Failed to connect to database: {}", e));
                std::process::exit(1);
            }
        };

        // DB-configured S3/image settings (Settings table) override env, same as index/sync.
        apply_db_overrides(&mut config, &pool).await;

        let targets = match only_targets(&pool, only).await {
            Ok(t) => t,
            Err(e) => {
                error_log::log_error(&format!("Failed to resolve artists: {}", e));
                reporter.failed(&format!("Failed to resolve artists: {}", e));
                std::process::exit(1);
            }
        };
        if targets.is_empty() {
            reporter.done(&format!("No artists match '{}'.", only));
            return;
        }

        let plan = match delete::artist::build_plan(&pool, &targets).await {
            Ok(p) => p,
            Err(e) => {
                error_log::log_error(&format!("Failed to build deletion plan: {}", e));
                reporter.failed(&format!("Failed to build deletion plan: {}", e));
                std::process::exit(1);
            }
        };

        reporter.kv("Artists to delete", &plan.artist_actions.len().to_string());
        for artist in &plan.artist_actions {
            let tag = if artist.is_cascaded {
                "cascaded"
            } else {
                "target"
            };
            let kept = if artist.other_credits_count > 0 {
                " - kept as credit-only artist"
            } else {
                ""
            };
            reporter.nested().info(&format!(
                "{} ({}) {}{}",
                artist.name, artist.slug, tag, kept
            ));
        }
        reporter.kv("Local releases", &plan.doomed_releases.len().to_string());
        let co_owned = plan.owned_releases.len() - plan.doomed_releases.len();
        if co_owned > 0 {
            reporter.kv(
                "Co-owned kept",
                &format!(
                    "{} (still owned by another artist - only unlinked)",
                    co_owned
                ),
            );
        }
        reporter.kv("Local tracks", &plan.track_count.to_string());
        reporter.blank();

        if args.dry_run {
            reporter.done("Dry run - no changes made.");
            return;
        }

        if !args.y {
            reporter.prompt("Type y to confirm: ");
            let mut input = String::new();
            io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                reporter.done("Aborted.");
                std::process::exit(0);
            }
            reporter.blank();
        }

        if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
            reporter.warn("Cleared a stale lock.");
        }
        let _lock_guard = match acquire_lock(&pool, "nuke", std::process::id()).await {
            Ok(g) => g,
            Err(e) => {
                reporter.failed(&format!("Cannot start: {}", e));
                std::process::exit(1);
            }
        };

        reporter.step("Deleting...");
        match delete::artist::execute_plan(&pool, &plan, &config, args.keep_artist_img).await {
            Ok((local, s3)) => {
                reporter.nested().ok(&format!(
                    "{} local image(s), {} S3 object(s) removed",
                    local, s3
                ));
            }
            Err(e) => {
                error_log::log_error(&e.to_string());
                reporter.failed(&format!("Error: {}", e));
                release_lock(&pool, "nuke", std::process::id()).await;
                std::process::exit(1);
            }
        }

        if let Err(e) = common::statistics::update_statistics(&pool).await {
            error_log::log_warn(&format!("statistics refresh failed: {e}"));
        }
        release_lock(&pool, "nuke", std::process::id()).await;

        reporter.blank();
        reporter.done(&format!(
            "{} artist(s), {} local release(s) deleted. Run ./index && ./sync to re-index the affected artists.",
            plan.artist_actions.len(),
            plan.doomed_releases.len()
        ));
        return;
    }

    // Full wipe mode
    reporter.header("DMP Nuke");
    reporter.blank();

    reporter.warn("This will DELETE ALL DATA from the database and images.");
    reporter.info(
        "This includes the download queue/history (DownloadedRelease) and the entire audit/fix",
    );
    reporter.info(
        "issue history (Issue* + FixHistory tables) - they cascade-truncate via their Artist FK",
    );
    reporter.info(
        "even though they aren't in the explicit truncate list below. Settings (web config +",
    );
    reporter.info("credentials) is preserved.");
    if args.keep_artist_img {
        reporter.info("Artist images will be preserved.");
    }
    reporter.kv("Database", &redact_url(&config.database_url));
    reporter.blank();

    if args.dry_run {
        reporter.done("Dry run - no changes made.");
        return;
    }

    if !args.y {
        reporter.prompt("Are you sure? Type 'y' to confirm: ");
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim() != "y" {
            reporter.done("Aborted.");
            std::process::exit(0);
        }
        reporter.blank();
    }

    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .connect(&config.database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            error_log::log_error(&format!("Failed to connect to database: {}", e));
            reporter.failed(&format!("Failed to connect to database: {}", e));
            std::process::exit(1);
        }
    };

    // Same DB scan lock index/sync use. Note: this full wipe TRUNCATEs the very "Statistics" row
    // that holds the lock columns - release_lock below becomes a harmless no-op in that case (0 rows
    // affected), and the next acquire_lock anywhere recreates the row via its own ON CONFLICT insert.
    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared a stale lock.");
    }
    let _lock_guard = match acquire_lock(&pool, "nuke", std::process::id()).await {
        Ok(g) => g,
        Err(e) => {
            reporter.failed(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    // DB-configured S3/image settings (Settings table) override env, same as index/sync. Safe to read
    // now: Settings is preserved by this wipe (see #52), not truncated below.
    apply_db_overrides(&mut config, &pool).await;

    reporter.step("Truncating all tables...");
    let tables = vec![
        "PlaylistTrack",
        "Playlist",
        "FavoriteTrack",
        "FavoriteRelease",
        "PlayEvent",
        "LocalReleaseTrackPlay",
        "TrackRelatedArtist",
        "LocalReleaseArtist",
        "LocalReleaseTrack",
        "LocalRelease",
        "MusicBrainzReleaseTrack",
        "MusicBrainzReleaseArtist",
        "MusicBrainzRelease",
        "ArtistUrl",
        "_ArtistGenres",
        "_ReleaseGenres",
        "Artist",
        "Genre",
        "ReleaseType",
        "Statistics",
        "FolderScan",
        "FixHistory",
        // Derived MusicBrainz name-resolution cache - a full nuke rebuilds it from scratch.
        "MbArtistLookup",
    ];

    let truncate = format!(
        "TRUNCATE TABLE {} CASCADE",
        tables
            .iter()
            .map(|t| format!(r#""{t}""#))
            .collect::<Vec<_>>()
            .join(", ")
    );
    if let Err(e) = sqlx::query(&truncate).execute(&pool).await {
        error_log::log_error(&format!("truncate failed: {e}"));
        reporter.failed(&format!("Truncate failed, nothing deleted: {}", e));
        release_lock(&pool, "nuke", std::process::id()).await;
        std::process::exit(1);
    }
    reporter
        .nested()
        .ok(&format!("Truncated {} tables", tables.len()));

    reporter.step("Deleting image files...");

    let img_dirs: Vec<(&str, PathBuf)> = vec![
        (
            "releases",
            PathBuf::from(&config.image_dir).join("releases"),
        ),
        ("artists", PathBuf::from(&config.image_dir).join("artists")),
    ];

    let mut local_deleted = 0usize;
    for (label, dir) in &img_dirs {
        if *label == "artists" && args.keep_artist_img {
            reporter
                .nested()
                .skip("Skipping artist images (--keep-artist-img)");
            continue;
        }
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                reporter
                    .nested()
                    .info(&format!("Deleting {}/{}", label, name));
                if fs::remove_file(&path).is_ok() {
                    local_deleted += 1;
                }
            }
        }
    }
    reporter
        .nested()
        .ok(&format!("Deleted {} local image(s)", local_deleted));

    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";

    if use_s3 {
        reporter.step("Deleting S3 images...");
        if let Some(s3_client) = create_s3_client(&config).await {
            if let Some(bucket) = &config.storage_bucket {
                let prefixes: Vec<&str> = if args.keep_artist_img {
                    vec!["releases/"]
                } else {
                    vec!["releases/", "artists/"]
                };
                let mut s3_deleted = 0usize;
                for prefix in prefixes {
                    match delete_s3_prefix(&s3_client, bucket, prefix, &reporter).await {
                        Ok(n) => s3_deleted += n,
                        Err(e) => {
                            error_log::log_error(&format!("S3 error ({}): {}", prefix, e));
                            reporter
                                .nested()
                                .warn(&format!("S3 error ({}): {}", prefix, e));
                        }
                    }
                }
                reporter
                    .nested()
                    .ok(&format!("Deleted {} S3 image(s)", s3_deleted));
            } else {
                reporter
                    .nested()
                    .skip("Skipped (STORAGE_IMAGE_BUCKET not set)");
            }
        } else {
            reporter
                .nested()
                .skip("Skipped (S3 credentials not configured)");
        }
    } else {
        reporter.info(&format!(
            "S3 images: skipped (IMAGE_STORAGE={})",
            config.image_storage
        ));
    }

    release_lock(&pool, "nuke", std::process::id()).await;
    reporter.blank();
    reporter.done("Done. Run ./index && ./sync to rebuild.");
}

#[cfg(test)]
mod tests {
    use super::redact_url;

    #[test]
    fn redact_url_drops_credentials() {
        assert_eq!(
            redact_url("postgresql://user:secret@db.example:5432/dmp?x=1"),
            "postgresql://db.example:5432/dmp?x=1"
        );
        assert_eq!(
            redact_url("postgresql://localhost/dmp"),
            "postgresql://localhost/dmp"
        );
    }
}
