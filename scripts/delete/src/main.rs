use aws_sdk_s3::Client as S3Client;
use clap::Parser;
use colored::*;
use common::{
    config::{apply_db_overrides, load_config, Config},
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    s3::create_s3_client,
    statistics::update_statistics,
};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "delete",
    about = "Permanently delete an artist's catalogue. If the artist is credited on \
             other artists' tracks, those credits are removed too - warned before confirming."
)]
struct Args {
    /// Artist name(s), separated by ';' for multiple (case-insensitive exact match)
    artist: String,

    /// Skip confirmation prompt
    #[arg(long)]
    y: bool,

    /// Show what would be deleted without changing anything
    #[arg(long)]
    dry_run: bool,
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .ok();
}

fn extract_s3_key(url: &str) -> Option<String> {
    if let Some(pos) = url.find(".com/") {
        return Some(url[pos + 5..].to_string());
    }
    let mut slashes = 0;
    for (i, c) in url.char_indices() {
        if c == '/' {
            slashes += 1;
            if slashes == 3 {
                return Some(url[i + 1..].to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ArtistAction {
    id: String,
    name: String,
    slug: String,
    image: Option<String>,
    image_url: Option<String>,
    is_cascaded: bool,
    /// Credits on tracks OUTSIDE the deletion set - purely informational, since this artist is deleted
    /// either way and those TrackRelatedArtist rows cascade away with it. Surfaced so the operator sees
    /// what else loses a credit before confirming.
    other_credits_count: i64,
}

#[derive(Debug, Default)]
struct DeletionPlan {
    artist_actions: Vec<ArtistAction>,
    local_releases: Vec<(String, Option<String>, Option<String>, Option<String>)>,
    mb_releases: Vec<String>,
    folder_paths: Vec<String>,
    track_count: i64,
}

async fn build_plan(
    pool: &PgPool,
    target_ids: &[(String, String)],
) -> Result<DeletionPlan, sqlx::Error> {
    // Collect all local + MB release IDs across all targets
    let mut local_release_ids: Vec<String> = Vec::new();
    let mut mb_release_ids: Vec<String> = Vec::new();
    let mut seen_local: HashSet<String> = HashSet::new();
    let mut seen_mb: HashSet<String> = HashSet::new();

    for (tid, _) in target_ids {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(tid)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            if seen_local.insert(id.clone()) {
                local_release_ids.push(id);
            }
        }

        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(tid)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            if seen_mb.insert(id.clone()) {
                mb_release_ids.push(id);
            }
        }
    }

    let local_set: HashSet<String> = local_release_ids.iter().cloned().collect();
    let mb_set: HashSet<String> = mb_release_ids.iter().cloned().collect();

    // Co-artist cascade: find artists whose entire catalogue is within deletion set
    let mut candidate_ids: HashSet<String> = HashSet::new();
    if !local_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = ANY($1::text[]) AND "artistId" <> ALL($2::text[])"#,
        )
        .bind(&local_release_ids)
        .bind(
            &target_ids
                .iter()
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>(),
        )
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }
    if !mb_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
               WHERE "releaseId" = ANY($1::text[]) AND "artistId" <> ALL($2::text[])"#,
        )
        .bind(&mb_release_ids)
        .bind(
            &target_ids
                .iter()
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>(),
        )
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    let mut cascaded: HashSet<String> = HashSet::new();
    for cand in &candidate_ids {
        let cand_local: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        let cand_mb: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        let local_ok = cand_local.is_subset(&local_set);
        let mb_ok = cand_mb.is_subset(&mb_set);
        let has_anything = !cand_local.is_empty() || !cand_mb.is_empty();

        if local_ok && mb_ok && has_anything {
            cascaded.insert(cand.clone());
        }
    }

    // All artist IDs in scope
    let mut all_artist_ids: Vec<String> = target_ids.iter().map(|(id, _)| id.clone()).collect();
    all_artist_ids.extend(cascaded.iter().cloned());

    let mut artist_actions: Vec<ArtistAction> = Vec::new();
    for aid in &all_artist_ids {
        let (other_credits,): (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM "TrackRelatedArtist" tra
               JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
               WHERE tra."artistId" = $1
                 AND lrt."localReleaseId" <> ALL($2::text[])"#,
        )
        .bind(aid)
        .bind(&local_release_ids)
        .fetch_one(pool)
        .await?;

        let row: (String, String, String, Option<String>, Option<String>) = sqlx::query_as(
            r#"SELECT id, name, slug, image, "imageUrl" FROM "Artist" WHERE id = $1"#,
        )
        .bind(aid)
        .fetch_one(pool)
        .await?;

        artist_actions.push(ArtistAction {
            id: row.0,
            name: row.1,
            slug: row.2,
            image: row.3,
            image_url: row.4,
            is_cascaded: cascaded.contains(aid),
            other_credits_count: other_credits,
        });
    }

    // Local releases with folder paths
    let local_releases: Vec<(String, Option<String>, Option<String>, Option<String>)> =
        if local_release_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as(
                r#"SELECT id, image, "imageUrl", "folderPath" FROM "LocalRelease" WHERE id = ANY($1::text[])"#,
            )
            .bind(&local_release_ids)
            .fetch_all(pool)
            .await?
        };

    let folder_paths: Vec<String> = local_releases
        .iter()
        .filter_map(|(_, _, _, fp)| fp.clone())
        .collect();

    // Track count
    let track_count: i64 = if local_release_ids.is_empty() {
        0
    } else {
        sqlx::query_as::<_, (i64,)>(
            r#"SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])"#,
        )
        .bind(&local_release_ids)
        .fetch_one(pool)
        .await?
        .0
    };

    Ok(DeletionPlan {
        artist_actions,
        local_releases,
        mb_releases: mb_release_ids,
        folder_paths,
        track_count,
    })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async fn execute_plan(
    pool: &PgPool,
    plan: &DeletionPlan,
    config: &Config,
    s3_client: &Option<S3Client>,
) -> Result<(usize, usize), sqlx::Error> {
    let use_local = config.image_storage == "local" || config.image_storage == "both";
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";

    let artist_img_dir = PathBuf::from(&config.image_dir).join("artists");
    let release_img_dir = PathBuf::from(&config.image_dir).join("releases");

    let mut local_deleted = 0usize;
    let mut s3_deleted = 0usize;

    // Artist images
    for action in &plan.artist_actions {
        let has_local = action.image.as_ref().map_or(false, |s| !s.is_empty());
        let has_s3 = action.image_url.as_ref().map_or(false, |s| !s.is_empty());
        if !has_local && !has_s3 {
            continue;
        }
        if use_local && has_local {
            let filename = action.image.as_ref().unwrap();
            if fs::remove_file(artist_img_dir.join(filename)).is_ok() {
                local_deleted += 1;
            }
        }
        if use_s3 && has_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.storage_bucket) {
                if let Some(key) = extract_s3_key(action.image_url.as_ref().unwrap()) {
                    delete_from_s3(s3, bucket, &key).await;
                    s3_deleted += 1;
                }
            }
        }
    }

    // Release covers
    for (_release_id, image, image_url, _) in &plan.local_releases {
        let has_local = image.as_ref().map_or(false, |s| !s.is_empty());
        let has_s3 = image_url.as_ref().map_or(false, |s| !s.is_empty());
        if !has_local && !has_s3 {
            continue;
        }
        if use_local && has_local {
            let filename = image.as_ref().unwrap();
            if fs::remove_file(release_img_dir.join(filename)).is_ok() {
                local_deleted += 1;
            }
        }
        if use_s3 && has_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.storage_bucket) {
                if let Some(key) = extract_s3_key(image_url.as_ref().unwrap()) {
                    delete_from_s3(s3, bucket, &key).await;
                    s3_deleted += 1;
                }
            }
        }
    }

    // DB - all in a transaction
    let mut tx = pool.begin().await?;

    let all_artist_ids: Vec<String> = plan.artist_actions.iter().map(|a| a.id.clone()).collect();
    // An artist still credited on tracks OUTSIDE the deletion set survives as a credit-only artist
    // (owns nothing here, but "appears on" someone else's release). Deleting the row would silently
    // strip those credits from releases the user never asked to touch. Ownership is derived, so there
    // is no flag to flip - simply not deleting the row is the whole change.
    let delete_ids: Vec<String> = plan
        .artist_actions
        .iter()
        .filter(|a| a.other_credits_count == 0)
        .map(|a| a.id.clone())
        .collect();
    let local_release_ids: Vec<String> = plan.local_releases.iter().map(|r| r.0.clone()).collect();

    // 1. _ArtistGenres (implicit junction, no cascade)
    if !all_artist_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "_ArtistGenres" WHERE "A" = ANY($1::text[])"#)
            .bind(&all_artist_ids)
            .execute(&mut *tx)
            .await?;
    }

    // 2. _ReleaseGenres (implicit junction, no cascade)
    if !plan.mb_releases.is_empty() {
        sqlx::query(r#"DELETE FROM "_ReleaseGenres" WHERE "B" = ANY($1::text[])"#)
            .bind(&plan.mb_releases)
            .execute(&mut *tx)
            .await?;
    }

    // 3. LocalRelease (cascades: tracks, release artists, TrackRelatedArtist, favorites, playlists, issues)
    if !local_release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
            .bind(&local_release_ids)
            .execute(&mut *tx)
            .await?;
    }

    // 4. MusicBrainzRelease (cascades: tracks, release artists, favorites)
    if !plan.mb_releases.is_empty() {
        sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE id = ANY($1::text[])"#)
            .bind(&plan.mb_releases)
            .execute(&mut *tx)
            .await?;
    }

    // 5. Artists with no surviving credits elsewhere. Those that DO keep credits are left in place and
    // simply become credit-only rows (see delete_ids above).
    if !delete_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
            .bind(&delete_ids)
            .execute(&mut *tx)
            .await?;
    }
    // Artists that survive lose their own catalogue metadata - they no longer own anything here.
    let kept_ids: Vec<String> = all_artist_ids
        .iter()
        .filter(|id| !delete_ids.contains(id))
        .cloned()
        .collect();
    if !kept_ids.is_empty() {
        sqlx::query(
            r#"UPDATE "Artist" SET image = NULL, "imageUrl" = NULL, "totalPlayCount" = 0,
                 "totalTracks" = 0, "totalFileSize" = 0, "updatedAt" = NOW()
               WHERE id = ANY($1::text[])"#,
        )
        .bind(&kept_ids)
        .execute(&mut *tx)
        .await?;
    }

    // 6/7. Sweep the local and MB releases this delete just orphaned, scoped to the deletion set.
    delete::sweep::sweep_orphaned_releases(&mut tx, &local_release_ids, &plan.mb_releases).await?;

    tx.commit().await?;

    // 8. FolderScan cleanup (non-critical, outside transaction)
    if !plan.folder_paths.is_empty() {
        sqlx::query(r#"DELETE FROM "FolderScan" WHERE "folderPath" = ANY($1::text[])"#)
            .bind(&plan.folder_paths)
            .execute(pool)
            .await
            .ok();
    }

    Ok((local_deleted, s3_deleted))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();
    error_log::init("delete");

    let artist_names: Vec<String> = args
        .artist
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    println!("{}", "DMP Delete".bright_cyan().bold());
    println!("{}", "==========".bright_black());
    if args.dry_run {
        println!(
            "Mode    : {}",
            "DRY RUN (no changes will be made)".yellow().bold()
        );
    }
    if artist_names.len() == 1 {
        println!("Target  : {}", artist_names[0].bright_white());
    } else {
        println!(
            "Targets : {} artists",
            artist_names.len().to_string().bright_white()
        );
        for name in &artist_names {
            println!("    {} {}", "•".bright_black(), name.bright_white());
        }
    }
    println!();

    let mut config = load_config(None);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    // DB-configured S3/image settings (Settings table) override env, same as index/sync - without
    // this, delete never sees S3 credentials that live only in Settings and silently skips deleting
    // the artist's images from S3.
    apply_db_overrides(&mut config, &pool).await;

    // Resolve target artists
    let mut target_ids: Vec<(String, String)> = Vec::new();
    for name in &artist_names {
        let matches: Vec<(String, String, String)> = sqlx::query_as(
            r#"SELECT id, name, slug FROM "Artist" WHERE LOWER(name) = LOWER($1) ORDER BY name ASC"#,
        )
        .bind(name)
        .fetch_all(&pool)
        .await
        .expect("Failed to query Artist table");

        match matches.len() {
            0 => {
                error_log::log_error(&format!("No artist found matching '{}'", name));
                eprintln!("{} No artist found matching '{}'", "✗".red(), name);
                std::process::exit(1);
            }
            1 => {
                target_ids.push((matches[0].0.clone(), matches[0].1.clone()));
            }
            n => {
                error_log::log_error(&format!("{} artists match '{}' - ambiguous", n, name));
                eprintln!("{} {} artists match '{}':", "✗".red(), n, name);
                for (_id, name, slug) in &matches {
                    eprintln!("    - {} ({})", name, slug.bright_black());
                }
                eprintln!("Refine the name and try again.");
                std::process::exit(1);
            }
        }
    }

    // Expand targets: include connected (linked) artists
    let mut connected_ids: Vec<(String, String)> = Vec::new();
    for (tid, _) in &target_ids {
        let rows: Vec<(String, String)> =
            sqlx::query_as(r#"SELECT id, name FROM "Artist" WHERE "primaryArtistId" = $1"#)
                .bind(tid)
                .fetch_all(&pool)
                .await
                .expect("Failed to query connected artists");
        for (id, name) in rows {
            connected_ids.push((id, name));
        }
    }
    if !connected_ids.is_empty() {
        println!(
            "Linked artists : {} (will be deleted with primary)",
            connected_ids.len().to_string().bright_white()
        );
        for (_, name) in &connected_ids {
            println!("    {} {}", "•".bright_black(), name.bright_white());
        }
        println!();
        target_ids.extend(connected_ids);
    }

    let plan = build_plan(&pool, &target_ids)
        .await
        .expect("Failed to build deletion plan");

    // Display plan
    println!("{}", "Plan".bright_cyan().bold());
    println!("{}", "----".bright_black());

    if !plan.artist_actions.is_empty() {
        println!(
            "Artists to delete: {}",
            plan.artist_actions.len().to_string().bright_white()
        );
        for a in &plan.artist_actions {
            let tag = if a.is_cascaded { "cascaded" } else { "target" };
            let warning = if a.other_credits_count > 0 {
                format!(
                    " - KEPT as credit-only artist: still credited on {} track(s) by other artists",
                    a.other_credits_count
                )
            } else {
                String::new()
            };
            println!(
                "    {} {}  {}",
                "•".bright_black(),
                a.name.bright_white(),
                format!("({}) {}{}", a.slug, tag, warning).bright_black()
            );
        }
    }

    println!(
        "Local releases  : {}",
        plan.local_releases.len().to_string().bright_white()
    );
    println!(
        "Local tracks    : {}",
        plan.track_count.to_string().bright_white()
    );
    println!(
        "MB releases     : {}",
        plan.mb_releases.len().to_string().bright_white()
    );
    println!();

    if plan.artist_actions.is_empty() {
        println!("Nothing to do.");
        return;
    }

    if args.dry_run {
        println!("{} (dry run - no changes made)", "✓".green());
        return;
    }

    // Confirm
    if !args.y {
        print!("Type y to confirm: ");
        io::stdout().flush().unwrap();
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim().to_lowercase() != "y" {
            println!("Aborted.");
            std::process::exit(0);
        }
        println!();
    }

    // Same DB scan lock index/sync use - acquired only now (not while waiting on the confirmation
    // prompt above) so delete's cascading writes never interleave with a running index/sync pass.
    if clear_stale_lock_minutes(&pool, 10).await {
        eprintln!("{}", "Cleared a stale lock.".yellow());
    }
    if let Err(e) = acquire_lock(&pool, "delete", std::process::id(), "").await {
        eprintln!("{}: {}", "Cannot start".red(), e);
        std::process::exit(1);
    }

    // Execute
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let s3_client = if use_s3 {
        create_s3_client(&config).await
    } else {
        None
    };

    println!("Deleting...");
    match execute_plan(&pool, &plan, &config, &s3_client).await {
        Ok((local, s3)) => {
            println!(
                "  {} {} local image(s), {} S3 object(s) removed",
                "✓".green(),
                local,
                s3
            );
        }
        Err(e) => {
            error_log::log_error(&format!("Database error: {}", e));
            eprintln!("  {} Database error: {}", "✗".red(), e);
            release_lock(&pool).await;
            std::process::exit(1);
        }
    }

    update_statistics(&pool).await.ok();
    release_lock(&pool).await;

    println!();
    let kept = plan
        .artist_actions
        .iter()
        .filter(|a| a.other_credits_count > 0)
        .count();
    println!(
        "{} {} artist(s) deleted, {} kept as credit-only.",
        "✓".green().bold(),
        plan.artist_actions.len() - kept,
        kept
    );
    println!(
        "  {} local release(s), {} MB release(s) deleted.",
        plan.local_releases.len(),
        plan.mb_releases.len()
    );
}
