use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use clap::Parser;
use colored::*;
use dotenvy;
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
    about = "Permanently delete an artist, their catalogue, and any related artists \
             whose entire catalogue is contained within the deleted releases."
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
// Configuration
// ---------------------------------------------------------------------------

struct DeleteConfig {
    database_url: String,
    project_root: String,
    image_dir: String,
    image_storage: String,
    s3_bucket: Option<String>,
    s3_region: Option<String>,
    s3_access_key: Option<String>,
    s3_secret_key: Option<String>,
    s3_endpoint: Option<String>,
}

fn load_config() -> DeleteConfig {
    let env_paths = [
        PathBuf::from("web/.env"),
        PathBuf::from("../../web/.env"),
    ];

    let mut env_loaded = false;
    for p in &env_paths {
        if p.exists() {
            dotenvy::from_path(p).ok();
            env_loaded = true;
            break;
        }
    }

    if !env_loaded {
        if let Ok(project_root) = std::env::var("PROJECT_ROOT") {
            let env_path = PathBuf::from(&project_root).join("web/.env");
            if env_path.exists() {
                dotenvy::from_path(env_path).ok();
            }
        }
    }

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");

    let project_root = std::env::var("PROJECT_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .ok()
            .and_then(|d| {
                if d.ends_with("scripts/delete") {
                    d.parent().and_then(|p| p.parent()).map(|p| p.to_string_lossy().to_string())
                } else if d.ends_with("scripts") {
                    d.parent().map(|p| p.to_string_lossy().to_string())
                } else {
                    Some(d.to_string_lossy().to_string())
                }
            })
            .unwrap_or_else(|| ".".to_string())
    });

    let image_dir = std::env::var("IMAGE_DIR").unwrap_or_else(|_| {
        PathBuf::from(&project_root)
            .join("web/public/img")
            .to_string_lossy()
            .to_string()
    });

    DeleteConfig {
        database_url,
        project_root,
        image_dir,
        image_storage: std::env::var("IMAGE_STORAGE").unwrap_or_else(|_| "local".to_string()),
        s3_bucket: std::env::var("S3_IMAGE_BUCKET").ok(),
        s3_region: std::env::var("AWS_REGION").ok(),
        s3_access_key: std::env::var("AWS_ACCESS_KEY_ID").ok(),
        s3_secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").ok(),
        s3_endpoint: std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty()),
    }
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

async fn create_s3_client(config: &DeleteConfig) -> Option<S3Client> {
    if config.s3_bucket.is_none() || config.s3_region.is_none() {
        return None;
    }

    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());

    if let Some(ref region) = config.s3_region {
        aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    }

    if let (Some(ref key), Some(ref secret)) = (&config.s3_access_key, &config.s3_secret_key) {
        aws_config = aws_config.credentials_provider(
            aws_sdk_s3::config::Credentials::new(key, secret, None, None, "delete"),
        );
    }

    let aws_config = aws_config.load().await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&aws_config);

    if let Some(ref endpoint) = config.s3_endpoint {
        s3_config = s3_config.endpoint_url(endpoint);
    }

    Some(S3Client::from_conf(s3_config.build()))
}

async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) {
    client.delete_object().bucket(bucket).key(key).send().await.ok();
}

/// Extract the S3 object key from a full URL.
/// "https://bucket.s3.region.amazonaws.com/artists/slug.jpg" → "artists/slug.jpg"
fn extract_s3_key(url: &str) -> Option<String> {
    // Try path after ".com/" or ".amazonaws.com/"
    if let Some(pos) = url.find(".com/") {
        return Some(url[pos + 5..].to_string());
    }
    // Fallback: anything after the third slash
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

#[derive(Debug, Default)]
struct DeletionPlan {
    artists: Vec<(String, String, String, Option<String>, Option<String>)>, // id, name, slug, image, imageUrl
    cascaded_artists: HashSet<String>, // ids that came in via the cascade rule (for display)
    local_releases: Vec<(String, Option<String>, Option<String>)>, // id, image, imageUrl
    mb_releases: Vec<String>, // ids
    track_count: i64,
}

async fn build_plan(pool: &PgPool, target_artist_id: &str) -> Result<DeletionPlan, sqlx::Error> {
    // Local releases linked to target
    let local_release_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
    )
    .bind(target_artist_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();

    // MB releases linked to target
    let mb_release_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
    )
    .bind(target_artist_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();

    // Sets we'll use for subset checks
    let local_set: HashSet<String> = local_release_ids.iter().cloned().collect();
    let mb_set: HashSet<String> = mb_release_ids.iter().cloned().collect();

    // Find candidate co-artists: anyone (other than target) sharing at least one
    // local OR MB release with the target.
    let mut candidate_ids: HashSet<String> = HashSet::new();
    if !local_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = ANY($1::text[]) AND "artistId" <> $2"#,
        )
        .bind(&local_release_ids)
        .bind(target_artist_id)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }
    if !mb_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
               WHERE "releaseId" = ANY($1::text[]) AND "artistId" <> $2"#,
        )
        .bind(&mb_release_ids)
        .bind(target_artist_id)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    // For each candidate: keep only those whose ENTIRE local AND MB catalogue is
    // a subset of the deletion frontier. Anyone with even one release outside
    // the frontier is left untouched (only their links to deleted releases will
    // be removed by the cascade).
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

        // Don't cascade if the candidate has no catalogue at all on either side
        // — that would be a misclassified ghost record we'd rather leave alone.
        let has_anything = !cand_local.is_empty() || !cand_mb.is_empty();

        if local_ok && mb_ok && has_anything {
            cascaded.insert(cand.clone());
        }
    }

    // Final artist deletion set = target + cascaded co-artists
    let mut all_artist_ids: Vec<String> = vec![target_artist_id.to_string()];
    all_artist_ids.extend(cascaded.iter().cloned());

    // Fetch full artist rows for display + image cleanup
    let artists: Vec<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT id, name, slug, image, "imageUrl" FROM "Artist"
           WHERE id = ANY($1::text[])
           ORDER BY name ASC"#,
    )
    .bind(&all_artist_ids)
    .fetch_all(pool)
    .await?;

    // Local release rows (need image fields)
    let local_releases: Vec<(String, Option<String>, Option<String>)> = if local_release_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            r#"SELECT id, image, "imageUrl" FROM "LocalRelease" WHERE id = ANY($1::text[])"#,
        )
        .bind(&local_release_ids)
        .fetch_all(pool)
        .await?
    };

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
        artists,
        cascaded_artists: cascaded,
        local_releases,
        mb_releases: mb_release_ids,
        track_count,
    })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async fn execute_plan(
    pool: &PgPool,
    plan: &DeletionPlan,
    config: &DeleteConfig,
    s3_client: &Option<S3Client>,
) -> Result<(usize, usize), sqlx::Error> {
    let use_local = config.image_storage == "local" || config.image_storage == "both";
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";

    let artist_img_dir = PathBuf::from(&config.image_dir).join("artists");
    let release_img_dir = PathBuf::from(&config.image_dir).join("releases");

    let mut local_deleted = 0usize;
    let mut s3_deleted = 0usize;

    // Artist images
    for (_id, _name, _slug, image, image_url) in &plan.artists {
        let has_local = image.as_ref().map_or(false, |s| !s.is_empty());
        let has_s3 = image_url.as_ref().map_or(false, |s| !s.is_empty());
        if !has_local && !has_s3 {
            continue;
        }
        if use_local && has_local {
            let filename = image.as_ref().unwrap();
            if fs::remove_file(artist_img_dir.join(filename)).is_ok() {
                local_deleted += 1;
            }
        }
        if use_s3 && has_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                // Extract S3 key from the full URL (everything after the bucket hostname)
                if let Some(key) = extract_s3_key(image_url.as_ref().unwrap()) {
                    delete_from_s3(s3, bucket, &key).await;
                    s3_deleted += 1;
                }
            }
        }
    }

    // Release covers
    for (_release_id, image, image_url) in &plan.local_releases {
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
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                if let Some(key) = extract_s3_key(image_url.as_ref().unwrap()) {
                    delete_from_s3(s3, bucket, &key).await;
                    s3_deleted += 1;
                }
            }
        }
    }

    // DB deletes — all wrapped in a transaction so a failure rolls everything back.
    let mut tx = pool.begin().await?;

    let artist_ids: Vec<String> = plan.artists.iter().map(|a| a.0.clone()).collect();
    let local_release_ids: Vec<String> = plan.local_releases.iter().map(|r| r.0.clone()).collect();

    // _ArtistGenres is an implicit Prisma M:N junction with no FK cascade.
    if !artist_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "_ArtistGenres" WHERE "A" = ANY($1::text[])"#)
            .bind(&artist_ids)
            .execute(&mut *tx)
            .await?;
    }

    // LocalRelease delete cascades to LocalReleaseTrack, LocalReleaseArtist, and
    // (via LocalReleaseTrack) TrackArtist + FavoriteTrack + PlaylistTrack.
    if !local_release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
            .bind(&local_release_ids)
            .execute(&mut *tx)
            .await?;
    }

    // MusicBrainzRelease delete cascades to MusicBrainzReleaseTrack,
    // MusicBrainzReleaseArtist, and FavoriteRelease.
    if !plan.mb_releases.is_empty() {
        sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE id = ANY($1::text[])"#)
            .bind(&plan.mb_releases)
            .execute(&mut *tx)
            .await?;
    }

    // Artist delete cascades to ArtistUrl, LocalReleaseArtist, MusicBrainzReleaseArtist, TrackArtist.
    if !artist_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
            .bind(&artist_ids)
            .execute(&mut *tx)
            .await?;
    }

    // Sweep: any LocalRelease that lost its last artist link.
    sqlx::query(
        r#"DELETE FROM "LocalRelease" WHERE id NOT IN (
            SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist"
        )"#,
    )
    .execute(&mut *tx)
    .await?;

    // Sweep: any MusicBrainzRelease that lost its last artist link.
    sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease" WHERE id NOT IN (
            SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist"
        )"#,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((local_deleted, s3_deleted))
}

// ---------------------------------------------------------------------------
// Statistics refresh
// ---------------------------------------------------------------------------

async fn refresh_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET
             artists = (SELECT COUNT(*)::int FROM "Artist"),
             "mainArtists" = (SELECT COUNT(*)::int FROM "Artist" a
                WHERE EXISTS (SELECT 1 FROM "TrackArtist" ta WHERE ta."artistId" = a.id)),
             "relatedArtists" = (SELECT COUNT(*)::int FROM "Artist" a
                WHERE NOT EXISTS (SELECT 1 FROM "TrackArtist" ta WHERE ta."artistId" = a.id)
                  AND EXISTS (SELECT 1 FROM "LocalReleaseArtist" lra WHERE lra."artistId" = a.id)),
             tracks = (SELECT COUNT(*)::int FROM "LocalReleaseTrack"),
             releases = (SELECT COUNT(*)::int FROM "LocalRelease"),
             "releasesWithCoverArt" = (SELECT COUNT(*)::int FROM "LocalRelease" WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             "artistsWithCoverArt" = (SELECT COUNT(*)::int FROM "Artist" WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             "artistsSyncedWithMusicbrainz" = (SELECT COUNT(*)::int FROM "Artist" WHERE "musicbrainzId" IS NOT NULL),
             "releasesSyncedWithMusicbrainz" = (SELECT COUNT(*)::int FROM "MusicBrainzRelease"),
             playtime = COALESCE((SELECT SUM(duration)::bigint FROM "LocalReleaseTrack"), 0),
             plays = COALESCE((SELECT SUM("playCount")::bigint FROM "LocalReleaseTrack"), 0),
             "updatedAt" = NOW()
           WHERE id = 'main'"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Parse artist names — split on ';' for multiple targets
    let artist_names: Vec<String> = args
        .artist
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    println!("{}", "DMP Delete".bright_cyan().bold());
    println!("{}", "==========".bright_black());
    if args.dry_run {
        println!("Mode    : {}", "DRY RUN (no changes will be made)".yellow().bold());
    }
    if artist_names.len() == 1 {
        println!("Target  : {}", artist_names[0].bright_white());
    } else {
        println!("Targets : {} artists", artist_names.len().to_string().bright_white());
        for name in &artist_names {
            println!("    {} {}", "•".bright_black(), name.bright_white());
        }
    }
    println!();

    let config = load_config();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    // Resolve each target artist by exact case-insensitive name match.
    let mut target_ids: Vec<(String, String)> = Vec::new(); // (id, name)
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
                eprintln!("{} No artist found matching '{}'", "✗".red(), name);
                std::process::exit(1);
            }
            1 => {
                target_ids.push((matches[0].0.clone(), matches[0].1.clone()));
            }
            n => {
                eprintln!("{} {} artists match '{}':", "✗".red(), n, name);
                for (_id, name, slug) in &matches {
                    eprintln!("    - {} ({})", name, slug.bright_black());
                }
                eprintln!("Refine the name and try again.");
                std::process::exit(1);
            }
        }
    }

    // Build a merged plan across all targets
    let mut merged = DeletionPlan::default();
    let mut seen_artist_ids: HashSet<String> = HashSet::new();
    let mut seen_local_ids: HashSet<String> = HashSet::new();
    let mut seen_mb_ids: HashSet<String> = HashSet::new();
    let target_id_set: HashSet<String> = target_ids.iter().map(|(id, _)| id.clone()).collect();

    for (tid, _tname) in &target_ids {
        let plan = build_plan(&pool, tid).await.expect("Failed to build deletion plan");

        for artist in plan.artists {
            if seen_artist_ids.insert(artist.0.clone()) {
                // Reclassify: if this was "cascaded" in one plan but is an explicit target, mark as target
                if target_id_set.contains(&artist.0) {
                    merged.artists.push(artist);
                } else {
                    merged.cascaded_artists.insert(artist.0.clone());
                    merged.artists.push(artist);
                }
            }
        }

        for lr in plan.local_releases {
            if seen_local_ids.insert(lr.0.clone()) {
                merged.local_releases.push(lr);
            }
        }

        for mb in plan.mb_releases {
            if seen_mb_ids.insert(mb.clone()) {
                merged.mb_releases.push(mb);
            }
        }

        merged.track_count += plan.track_count;
    }

    // Deduplicate track count (tracks may be shared across plans)
    if !seen_local_ids.is_empty() {
        let lr_ids: Vec<String> = seen_local_ids.into_iter().collect();
        let tc: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])"#,
        )
        .bind(&lr_ids)
        .fetch_one(&pool)
        .await
        .expect("Failed to count tracks");
        merged.track_count = tc.0;
    }

    let plan = merged;

    // ---------- Display the plan ----------
    println!("{}", "Plan".bright_cyan().bold());
    println!("{}", "----".bright_black());
    println!("Artists to delete: {}", plan.artists.len().to_string().bright_white());
    for (id, name, slug, _img, _img_url) in &plan.artists {
        let tag = if target_id_set.contains(id) {
            "target".bright_white()
        } else if plan.cascaded_artists.contains(id) {
            "cascaded".yellow()
        } else {
            "".normal()
        };
        println!("    {} {}  {}",
            "•".bright_black(),
            name.bright_white(),
            format!("({}) {}", slug, tag).bright_black());
    }
    println!("Local releases  : {}", plan.local_releases.len().to_string().bright_white());
    println!("Local tracks    : {}", plan.track_count.to_string().bright_white());
    println!("MB releases     : {}", plan.mb_releases.len().to_string().bright_white());
    println!();

    if plan.artists.is_empty() {
        println!("Nothing to do.");
        return;
    }

    if args.dry_run {
        println!("{} (dry run — no changes made)", "✓".green());
        return;
    }

    // ---------- Confirm ----------
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

    // ---------- Execute ----------
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let s3_client = if use_s3 { create_s3_client(&config).await } else { None };

    println!("Deleting...");
    match execute_plan(&pool, &plan, &config, &s3_client).await {
        Ok((local, s3)) => {
            println!("  {} {} local image(s), {} S3 object(s) removed",
                "✓".green(), local, s3);
        }
        Err(e) => {
            eprintln!("  {} Database error: {}", "✗".red(), e);
            std::process::exit(1);
        }
    }

    refresh_statistics(&pool).await.ok();

    println!();
    println!("{} {} artist(s), {} local release(s), {} MB release(s) deleted.",
        "✓".green().bold(),
        plan.artists.len(),
        plan.local_releases.len(),
        plan.mb_releases.len());
}
