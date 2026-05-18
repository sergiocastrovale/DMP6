use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use clap::Parser;
use colored::*;
use common::filters::matches_filter;
use dotenvy;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

/// println that always flushes immediately (Rust buffers stdout when not a TTY)
macro_rules! log {
    () => {{
        writeln!(io::stdout()).ok();
        io::stdout().flush().ok();
    }};
    ($($arg:tt)*) => {{
        writeln!(io::stdout(), $($arg)*).ok();
        io::stdout().flush().ok();
    }};
}

#[derive(Parser, Debug)]
#[command(name = "nuke", about = "Delete all data from DMP database and images")]
struct Args {
    /// Skip confirmation prompt
    #[arg(long)]
    y: bool,

    /// Keep artist images (local files and S3 objects under artists/)
    #[arg(long)]
    keep_artist_img: bool,

    /// Delete only matching artist(s) — semicolon-separated, exact match
    #[arg(long)]
    only: Option<String>,

    /// Show what would be deleted without making any changes
    #[arg(long)]
    dry_run: bool,
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

async fn create_s3_client() -> Option<S3Client> {
    let s3_bucket = std::env::var("S3_IMAGE_BUCKET").ok();
    let s3_region = std::env::var("AWS_REGION").ok();

    if s3_bucket.is_none() || s3_region.is_none() {
        return None;
    }

    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());

    if let Some(ref region) = s3_region {
        aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    }

    if let (Some(key), Some(secret)) = (
        std::env::var("AWS_ACCESS_KEY_ID").ok(),
        std::env::var("AWS_SECRET_ACCESS_KEY").ok(),
    ) {
        aws_config = aws_config.credentials_provider(aws_sdk_s3::config::Credentials::new(
            key, secret, None, None, "nuke",
        ));
    }

    let aws_config = aws_config.load().await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&aws_config);

    if let Some(endpoint) = std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty()) {
        s3_config = s3_config.endpoint_url(endpoint);
    }

    Some(S3Client::from_conf(s3_config.build()))
}

async fn delete_s3_prefix(
    client: &S3Client,
    bucket: &str,
    prefix: &str,
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
                    .map(|k| ObjectIdentifier::builder().key(k).build().ok())
                    .flatten()
            })
            .collect();

        let count = identifiers.len();
        if count > 0 {
            log!("  Deleting {} S3 objects from {}...", count, prefix.trim_end_matches('/'));
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

async fn delete_s3_object(client: &S3Client, bucket: &str, key: &str) {
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
// --only mode
// ---------------------------------------------------------------------------

struct ArtistRow {
    id: String,
    name: String,
    slug: String,
    image: Option<String>,
    image_url: Option<String>,
}

struct LocalReleaseRow {
    id: String,
    image: Option<String>,
    image_url: Option<String>,
}

struct OnlyPlan {
    artists: Vec<ArtistRow>,
    target_ids: HashSet<String>,
    cascade_ids: HashSet<String>,
    local_releases: Vec<LocalReleaseRow>,
    mb_release_ids: Vec<String>,
    track_count: i64,
    folder_paths: Vec<String>,
}

async fn build_only_plan(pool: &PgPool, only: &str, exact: bool) -> Result<OnlyPlan, sqlx::Error> {
    let all_artists: Vec<(String, String, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"SELECT id, name, slug, image, "imageUrl" FROM "Artist" ORDER BY name"#,
        )
        .fetch_all(pool)
        .await?;

    let target_ids: HashSet<String> = all_artists
        .iter()
        .filter(|(_, name, _, _, _)| matches_filter(name, "", "", only, exact))
        .map(|(id, _, _, _, _)| id.clone())
        .collect();

    if target_ids.is_empty() {
        return Ok(OnlyPlan {
            artists: vec![],
            target_ids,
            cascade_ids: HashSet::new(),
            local_releases: vec![],
            mb_release_ids: vec![],
            track_count: 0,
            folder_paths: vec![],
        });
    }

    let target_id_vec: Vec<String> = target_ids.iter().cloned().collect();

    // Collect all local + MB releases linked to any target
    let local_release_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist"
           WHERE "artistId" = ANY($1::text[])"#,
    )
    .bind(&target_id_vec)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();

    let mb_release_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist"
           WHERE "artistId" = ANY($1::text[])"#,
    )
    .bind(&target_id_vec)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();

    let local_set: HashSet<String> = local_release_ids.iter().cloned().collect();
    let mb_set: HashSet<String> = mb_release_ids.iter().cloned().collect();

    // Find all co-artists sharing any of those releases or tracks
    let mut candidate_ids: HashSet<String> = HashSet::new();

    if !local_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = ANY($1::text[]) AND "artistId" != ALL($2::text[])"#,
        )
        .bind(&local_release_ids)
        .bind(&target_id_vec)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    if !mb_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
               WHERE "releaseId" = ANY($1::text[]) AND "artistId" != ALL($2::text[])"#,
        )
        .bind(&mb_release_ids)
        .bind(&target_id_vec)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    // Also surface artists who appear via TrackRelatedArtist on tracks in these releases
    if !local_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT ta."artistId" FROM "TrackRelatedArtist" ta
               JOIN "LocalReleaseTrack" lrt ON lrt.id = ta."trackId"
               WHERE lrt."localReleaseId" = ANY($1::text[])
                 AND ta."artistId" != ALL($2::text[])"#,
        )
        .bind(&local_release_ids)
        .bind(&target_id_vec)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    // Cascade check: co-artist Y cascades only if ALL three hold:
    //   1. Every LocalReleaseArtist row for Y points into the deletion set
    //   2. Every MusicBrainzReleaseArtist row for Y points into the deletion set
    //   3. No TrackRelatedArtist rows for Y link to tracks in releases outside the deletion set
    let mut cascade_ids: HashSet<String> = HashSet::new();

    for cand_id in &candidate_ids {
        let cand_local: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        let cand_mb: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        // Any tracks in releases outside the deletion set?
        let outside_tracks: i64 = if local_release_ids.is_empty() {
            sqlx::query_as::<_, (i64,)>(
                r#"SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "artistId" = $1"#,
            )
            .bind(cand_id)
            .fetch_one(pool)
            .await?
            .0
        } else {
            sqlx::query_as::<_, (i64,)>(
                r#"SELECT COUNT(*) FROM "TrackRelatedArtist" ta
                   JOIN "LocalReleaseTrack" lrt ON lrt.id = ta."trackId"
                   WHERE ta."artistId" = $1
                     AND lrt."localReleaseId" IS NOT NULL
                     AND lrt."localReleaseId" != ALL($2::text[])"#,
            )
            .bind(cand_id)
            .bind(&local_release_ids)
            .fetch_one(pool)
            .await?
            .0
        };

        let local_ok = cand_local.is_subset(&local_set);
        let mb_ok = cand_mb.is_subset(&mb_set);
        let track_ok = outside_tracks == 0;
        let has_anything = !cand_local.is_empty() || !cand_mb.is_empty();

        if local_ok && mb_ok && track_ok && has_anything {
            cascade_ids.insert(cand_id.clone());
        }
    }

    // Full deletion artist set
    let all_artist_ids: Vec<String> = target_ids
        .iter()
        .chain(cascade_ids.iter())
        .cloned()
        .collect();

    let artist_rows: Vec<(String, String, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"SELECT id, name, slug, image, "imageUrl" FROM "Artist"
               WHERE id = ANY($1::text[]) ORDER BY name ASC"#,
        )
        .bind(&all_artist_ids)
        .fetch_all(pool)
        .await?;

    let artists: Vec<ArtistRow> = artist_rows
        .into_iter()
        .map(|(id, name, slug, image, image_url)| ArtistRow {
            id,
            name,
            slug,
            image,
            image_url,
        })
        .collect();

    let local_release_data: Vec<(String, Option<String>, Option<String>, Option<String>)> =
        if local_release_ids.is_empty() {
            vec![]
        } else {
            sqlx::query_as(
                r#"SELECT id, image, "imageUrl", "folderPath" FROM "LocalRelease"
                   WHERE id = ANY($1::text[])"#,
            )
            .bind(&local_release_ids)
            .fetch_all(pool)
            .await?
        };

    let folder_paths: Vec<String> = local_release_data
        .iter()
        .filter_map(|(_, _, _, fp)| fp.clone())
        .collect();

    let local_releases: Vec<LocalReleaseRow> = local_release_data
        .into_iter()
        .map(|(id, image, image_url, _)| LocalReleaseRow { id, image, image_url })
        .collect();

    let track_count: i64 = if local_release_ids.is_empty() {
        0
    } else {
        sqlx::query_as::<_, (i64,)>(
            r#"SELECT COUNT(*) FROM "LocalReleaseTrack"
               WHERE "localReleaseId" = ANY($1::text[])"#,
        )
        .bind(&local_release_ids)
        .fetch_one(pool)
        .await?
        .0
    };

    Ok(OnlyPlan {
        artists,
        target_ids,
        cascade_ids,
        local_releases,
        mb_release_ids,
        track_count,
        folder_paths,
    })
}

async fn execute_only_plan(
    pool: &PgPool,
    plan: &OnlyPlan,
    image_dir: &str,
    image_storage: &str,
    s3_client: &Option<S3Client>,
    s3_bucket: &Option<String>,
    keep_artist_img: bool,
) -> Result<(usize, usize), Box<dyn std::error::Error>> {
    let use_local = image_storage == "local" || image_storage == "both";
    let use_s3 = image_storage == "s3" || image_storage == "both";

    let artist_img_dir = PathBuf::from(image_dir).join("artists");
    let release_img_dir = PathBuf::from(image_dir).join("releases");

    let mut local_deleted = 0usize;
    let mut s3_deleted = 0usize;

    if !keep_artist_img {
        for artist in &plan.artists {
            if use_local {
                if let Some(ref img) = artist.image {
                    if !img.is_empty() {
                        log!("  Deleting local artist image: {}", img);
                        if fs::remove_file(artist_img_dir.join(img)).is_ok() {
                            local_deleted += 1;
                        }
                    }
                }
            }
            if use_s3 {
                if let Some(ref url) = artist.image_url {
                    if !url.is_empty() {
                        if let (Some(ref s3), Some(ref bucket)) = (s3_client, s3_bucket) {
                            if let Some(key) = extract_s3_key(url) {
                                log!("  Deleting S3 artist image: {}", key);
                                delete_s3_object(s3, bucket, &key).await;
                                s3_deleted += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    for release in &plan.local_releases {
        if use_local {
            if let Some(ref img) = release.image {
                if !img.is_empty() {
                    log!("  Deleting local release image: {}", img);
                    if fs::remove_file(release_img_dir.join(img)).is_ok() {
                        local_deleted += 1;
                    }
                }
            }
        }
        if use_s3 {
            if let Some(ref url) = release.image_url {
                if !url.is_empty() {
                    if let (Some(ref s3), Some(ref bucket)) = (s3_client, s3_bucket) {
                        if let Some(key) = extract_s3_key(url) {
                            log!("  Deleting S3 release image: {}", key);
                            delete_s3_object(s3, bucket, &key).await;
                            s3_deleted += 1;
                        }
                    }
                }
            }
        }
    }

    let artist_ids: Vec<String> = plan.artists.iter().map(|a| a.id.clone()).collect();
    let local_release_ids: Vec<String> = plan.local_releases.iter().map(|r| r.id.clone()).collect();

    let mut tx = pool.begin().await?;

    // _ArtistGenres and _ReleaseGenres are implicit Prisma M:N tables with no FK cascade
    if !artist_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "_ArtistGenres" WHERE "A" = ANY($1::text[])"#)
            .bind(&artist_ids)
            .execute(&mut *tx)
            .await?;
    }

    if !plan.mb_release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "_ReleaseGenres" WHERE "B" = ANY($1::text[])"#)
            .bind(&plan.mb_release_ids)
            .execute(&mut *tx)
            .await?;
    }

    // LocalRelease cascades: LocalReleaseTrack, LocalReleaseArtist, FavoriteTrack,
    //                        PlaylistTrack, TrackRelatedArtist
    // Must delete before MusicBrainzRelease so LocalReleaseTrack.mbTrackId refs are gone first
    if !local_release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
            .bind(&local_release_ids)
            .execute(&mut *tx)
            .await?;
    }

    // MusicBrainzRelease cascades: MusicBrainzReleaseTrack, MusicBrainzReleaseArtist,
    //                              FavoriteRelease
    if !plan.mb_release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE id = ANY($1::text[])"#)
            .bind(&plan.mb_release_ids)
            .execute(&mut *tx)
            .await?;
    }

    // Artist cascades: ArtistUrl, remaining junction rows
    if !artist_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
            .bind(&artist_ids)
            .execute(&mut *tx)
            .await?;
    }

    // Sweep releases that lost all artist links (shared releases now orphaned)
    sqlx::query(
        r#"DELETE FROM "LocalRelease" WHERE id NOT IN (
               SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist"
           )"#,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease" WHERE id NOT IN (
               SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist"
           )"#,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // FolderScan cleanup (outside transaction — non-critical)
    if !plan.folder_paths.is_empty() {
        sqlx::query(r#"DELETE FROM "FolderScan" WHERE "folderPath" = ANY($1::text[])"#)
            .bind(&plan.folder_paths)
            .execute(pool)
            .await
            .ok();
    }

    Ok((local_deleted, s3_deleted))
}

async fn refresh_statistics(pool: &PgPool) {
    sqlx::query(
        r#"UPDATE "Statistics" SET
             artists = (SELECT COUNT(*)::int FROM "Artist"),
             "mainArtists" = (SELECT COUNT(*)::int FROM "Artist" WHERE "relatedOnly" = false),
             "relatedArtists" = (SELECT COUNT(*)::int FROM "Artist" WHERE "relatedOnly" = true),
             tracks = (SELECT COUNT(*)::int FROM "LocalReleaseTrack"),
             releases = (SELECT COUNT(*)::int FROM "LocalRelease"),
             "releasesWithCoverArt" = (SELECT COUNT(*)::int FROM "LocalRelease"
                WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             "artistsWithCoverArt" = (SELECT COUNT(*)::int FROM "Artist"
                WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             "artistsSyncedWithMusicbrainz" = (SELECT COUNT(*)::int FROM "Artist"
                WHERE "musicbrainzId" IS NOT NULL),
             "releasesSyncedWithMusicbrainz" = (SELECT COUNT(*)::int FROM "MusicBrainzRelease"),
             playtime = COALESCE((SELECT SUM(duration)::bigint FROM "LocalReleaseTrack"), 0),
             plays = COALESCE((SELECT SUM("playCount")::bigint FROM "LocalReleaseTrack"), 0),
             "updatedAt" = NOW()
           WHERE id = 'main'"#,
    )
    .execute(pool)
    .await
    .ok();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();

    let env_paths = [PathBuf::from("web/.env"), PathBuf::from("../../web/.env")];
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

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Error: DATABASE_URL not found in web/.env");
            std::process::exit(1);
        }
    };

    let project_root = std::env::var("PROJECT_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .ok()
            .and_then(|d| {
                if d.ends_with("scripts/nuke") {
                    d.parent()
                        .and_then(|p| p.parent())
                        .map(|p| p.to_string_lossy().to_string())
                } else if d.ends_with("scripts") {
                    d.parent().map(|p| p.to_string_lossy().to_string())
                } else {
                    Some(d.to_string_lossy().to_string())
                }
            })
            .unwrap_or_else(|| ".".to_string())
    });

    let image_storage =
        std::env::var("IMAGE_STORAGE").unwrap_or_else(|_| "local".to_string());
    let image_dir = std::env::var("IMAGE_DIR").unwrap_or_else(|_| {
        PathBuf::from(&project_root)
            .join("web/public/img")
            .to_string_lossy()
            .to_string()
    });
    let s3_bucket = std::env::var("S3_IMAGE_BUCKET").ok();

    // --only mode: selective artist deletion
    if let Some(ref only) = args.only {
        log!("{}", "DMP Nuke --only".bright_cyan().bold());
        log!("{}", "===============".bright_black());
        if args.dry_run {
            log!("Mode: {}", "DRY RUN (no changes will be made)".yellow().bold());
        }
        log!();

        let pool = match PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
        {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Failed to connect to database: {}", e);
                std::process::exit(1);
            }
        };

        let plan = match build_only_plan(&pool, only, true).await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Failed to build deletion plan: {}", e);
                std::process::exit(1);
            }
        };

        if plan.artists.is_empty() {
            log!("No artists match '{}'.", only);
            return;
        }

        log!("Artists to delete  : {}", plan.artists.len().to_string().bright_white());
        for artist in &plan.artists {
            let tag = if plan.target_ids.contains(&artist.id) {
                "target".bright_white()
            } else if plan.cascade_ids.contains(&artist.id) {
                "cascaded".yellow()
            } else {
                "".normal()
            };
            log!(
                "  {} {}  {}",
                "•".bright_black(),
                artist.name.bright_white(),
                format!("({}) {}", artist.slug, tag).bright_black()
            );
        }
        log!("Local releases     : {}", plan.local_releases.len().to_string().bright_white());
        log!("Local tracks       : {}", plan.track_count.to_string().bright_white());
        log!("MB releases        : {}", plan.mb_release_ids.len().to_string().bright_white());
        log!();

        if args.dry_run {
            log!("{} (dry run — no changes made)", "✓".green());
            return;
        }

        if !args.y {
            print!("Type y to confirm: ");
            io::stdout().flush().unwrap();
            let mut input = String::new();
            io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                log!("Aborted.");
                std::process::exit(0);
            }
            log!();
        }

        let use_s3 = image_storage == "s3" || image_storage == "both";
        let s3_client = if use_s3 { create_s3_client().await } else { None };

        log!("Deleting...");
        match execute_only_plan(
            &pool,
            &plan,
            &image_dir,
            &image_storage,
            &s3_client,
            &s3_bucket,
            args.keep_artist_img,
        )
        .await
        {
            Ok((local, s3)) => {
                log!(
                    "  {} {} local image(s), {} S3 object(s) removed",
                    "✓".green(),
                    local,
                    s3
                );
            }
            Err(e) => {
                eprintln!("  {} Error: {}", "✗".red(), e);
                std::process::exit(1);
            }
        }

        refresh_statistics(&pool).await;

        log!();
        log!(
            "{} {} artist(s), {} local release(s), {} MB release(s) deleted.",
            "✓".green().bold(),
            plan.artists.len(),
            plan.local_releases.len(),
            plan.mb_release_ids.len()
        );
        log!("Run ./index && ./sync to re-index the affected artists.");
        return;
    }

    // Full wipe mode
    log!("DMP Database Nuke");
    log!("=================");
    log!();

    log!("WARNING: This will DELETE ALL DATA from the database and images.");
    if args.keep_artist_img {
        log!("Artist images will be preserved.");
    }
    log!("Database: {}", database_url);
    log!();

    if args.dry_run {
        log!("(dry run — no changes made)");
        return;
    }

    if !args.y {
        print!("Are you sure? Type 'y' to confirm: ");
        io::stdout().flush().unwrap();
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim() != "y" {
            log!("Aborted.");
            std::process::exit(0);
        }
        log!();
    }

    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to connect to database: {}", e);
            std::process::exit(1);
        }
    };

    log!("Truncating all tables...");
    let tables = vec![
        "PlaylistTrack",
        "Playlist",
        "FavoriteTrack",
        "FavoriteRelease",
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
        "SearchSource",
        "Settings",
        "Statistics",
        "FolderScan",
    ];

    for table in &tables {
        log!("  Truncating {}...", table);
        if let Err(e) = sqlx::query(&format!(r#"TRUNCATE TABLE "{}" CASCADE"#, table))
            .execute(&pool)
            .await
        {
            log!("  {} Error truncating {}: {}", "✗".red(), table, e);
        }
    }
    log!("  {} Truncated {} tables", "✓".green(), tables.len());

    log!();
    log!("Deleting image files...");

    let img_dirs: Vec<(&str, PathBuf)> = vec![
        ("releases", PathBuf::from(&image_dir).join("releases")),
        ("artists", PathBuf::from(&image_dir).join("artists")),
    ];

    let mut local_deleted = 0usize;
    for (label, dir) in &img_dirs {
        if *label == "artists" && args.keep_artist_img {
            log!("  Skipping artist images (--keep-artist-img)");
            continue;
        }
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                log!("  Deleting {}/{}", label, name);
                if fs::remove_file(&path).is_ok() {
                    local_deleted += 1;
                }
            }
        }
    }
    log!("  {} Deleted {} local image(s)", "✓".green(), local_deleted);

    let use_s3 = image_storage == "s3" || image_storage == "both";

    if use_s3 {
        log!("Deleting S3 images...");
        if let Some(s3_client) = create_s3_client().await {
            if let Some(bucket) = &s3_bucket {
                let prefixes: Vec<&str> = if args.keep_artist_img {
                    vec!["releases/"]
                } else {
                    vec!["releases/", "artists/"]
                };
                let mut s3_deleted = 0usize;
                for prefix in prefixes {
                    match delete_s3_prefix(&s3_client, bucket, prefix).await {
                        Ok(n) => s3_deleted += n,
                        Err(e) => eprintln!("  {} S3 error ({}): {}", "✗".red(), prefix, e),
                    }
                }
                log!("  {} Deleted {} S3 image(s)", "✓".green(), s3_deleted);
            } else {
                log!("  {} Skipped (S3_IMAGE_BUCKET not set)", "–".bright_black());
            }
        } else {
            log!("  {} Skipped (S3 credentials not configured)", "–".bright_black());
        }
    } else {
        log!(
            "S3 images: {} (IMAGE_STORAGE={})",
            "skipped".bright_black(),
            image_storage.bright_black()
        );
    }

    log!();
    log!("Done. Run ./index && ./sync to rebuild.");
}
