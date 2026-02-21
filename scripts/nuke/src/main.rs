use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use clap::Parser;
use dotenvy;
use sqlx::postgres::PgPoolOptions;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "dmp-nuke", about = "Delete all data from DMP database")]
struct Args {
    /// Skip confirmation prompt
    #[arg(long)]
    yes: bool,
}

async fn create_s3_client() -> Option<S3Client> {
    let S3_IMAGE_BUCKET = std::env::var("S3_IMAGE_BUCKET").ok();
    let AWS_REGION = std::env::var("AWS_REGION").ok();
    
    if S3_IMAGE_BUCKET.is_none() || AWS_REGION.is_none() {
        return None;
    }
    
    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());
    
    if let Some(ref region) = AWS_REGION {
        aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    }
    
    if let (Some(key), Some(secret)) = (
        std::env::var("AWS_ACCESS_KEY_ID").ok(),
        std::env::var("AWS_SECRET_ACCESS_KEY").ok()
    ) {
        aws_config = aws_config.credentials_provider(
            aws_sdk_s3::config::Credentials::new(
                key,
                secret,
                None,
                None,
                "dmp-nuke"
            )
        );
    }
    
    let aws_config = aws_config.load().await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&aws_config);
    
    if let Some(endpoint) = std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty()) {
        s3_config = s3_config.endpoint_url(endpoint);
    }
    
    Some(S3Client::from_conf(s3_config.build()))
}

async fn delete_s3_images(client: &S3Client, bucket: &str) -> Result<usize, Box<dyn std::error::Error>> {
    let mut deleted_count = 0;
    
    // Delete all objects in releases/ folder
    let list_releases = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix("releases/")
        .send()
        .await?;
    
    if let Some(objects) = list_releases.contents {
        for obj in objects {
            if let Some(key) = obj.key {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(&key)
                    .send()
                    .await?;
                deleted_count += 1;
            }
        }
    }
    
    // Delete all objects in artists/ folder
    let list_artists = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix("artists/")
        .send()
        .await?;
    
    if let Some(objects) = list_artists.contents {
        for obj in objects {
            if let Some(key) = obj.key {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(&key)
                    .send()
                    .await?;
                deleted_count += 1;
            }
        }
    }
    
    Ok(deleted_count)
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    println!("DMP Database Nuke");
    println!("=================");
    println!();

    // Load DATABASE_URL
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

    // If no relative .env found, try PROJECT_ROOT from environment
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

    println!("⚠️  WARNING: This will DELETE ALL DATA from the database!");
    println!("Database: {}", database_url);
    println!();

    if !args.yes {
        print!("Are you sure you want to continue? Type 'yes' to confirm: ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();

        if input.trim() != "yes" {
            println!("Aborted.");
            std::process::exit(0);
        }
        println!();
    }

    println!("Connecting to database...");

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

    println!("Nuking all tables...");

    // Truncate all tables in correct order (respecting foreign key constraints)
    let tables = vec![
        "PlaylistTrack",
        "Playlist",
        "FavoriteTrack",
        "FavoriteRelease",
        "TrackArtist",
        "LocalReleaseTrack",
        "LocalRelease",
        "musicbrainz_release_tracks",
        "musicbrainz_releases",
        "ArtistUrl",
        "_ArtistGenres",
        "_ReleaseGenres",
        "Artist",
        "Genre",
        "ReleaseType",
        "SearchSource",
        "Settings",
        "Statistics",
        "IndexCheckpoint",
        "S3DeletionQueue",
    ];

    for table in &tables {
        match sqlx::query(&format!(r#"TRUNCATE TABLE "{}" CASCADE"#, table))
            .execute(&pool)
            .await
        {
            Ok(_) => println!("  ✓ Truncated {}", table),
            Err(e) => {
                eprintln!("  ✗ Error truncating {}: {}", table, e);
            }
        }
    }

    // Verify all tables are empty
    println!();
    println!("Verifying...");

    let result: Result<Vec<(String, i64)>, sqlx::Error> = sqlx::query_as(
        r#"
        SELECT tablename::text, 
               (xpath('/row/cnt/text()', xml_count))[1]::text::bigint as row_count
        FROM (
            SELECT tablename,
                   query_to_xml(format('SELECT COUNT(*) as cnt FROM %I.%I', schemaname, tablename), false, true, '') as xml_count
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        ) t
        WHERE (xpath('/row/cnt/text()', xml_count))[1]::text::bigint > 0
        "#
    )
    .fetch_all(&pool)
    .await;

    match result {
        Ok(rows) => {
            if rows.is_empty() {
                println!("  ✓ All tables are empty");
            } else {
                println!("  ⚠ Some tables still have data:");
                for (table, count) in rows {
                    println!("    - {}: {} rows", table, count);
                }
            }
        }
        Err(e) => {
            eprintln!("  ✗ Error verifying: {}", e);
        }
    }

    println!();
    println!("✓ Database nuked successfully!");
    
    // Delete image files (local)
    println!();
    println!("Deleting local image files...");
    
    let project_root = std::env::var("PROJECT_ROOT")
        .unwrap_or_else(|_| {
            // Try to detect project root from current directory
            std::env::current_dir()
                .ok()
                .and_then(|d| {
                    // If we're in scripts/nuke, go up two levels
                    if d.ends_with("scripts/nuke") {
                        d.parent().and_then(|p| p.parent()).map(|p| p.to_string_lossy().to_string())
                    } else if d.ends_with("scripts") {
                        d.parent().map(|p| p.to_string_lossy().to_string())
                    } else {
                        Some(d.to_string_lossy().to_string())
                    }
                })
                .unwrap_or_else(|| ".".to_string())
        });
    
    let image_dirs = vec![
        PathBuf::from(&project_root).join("web/public/img/releases"),
        PathBuf::from(&project_root).join("web/public/img/artists"),
    ];
    
    let mut local_deleted_count = 0;
    
    for dir in &image_dirs {
        if !dir.exists() {
            continue;
        }
        
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                    if fs::remove_file(&path).is_ok() {
                        local_deleted_count += 1;
                    }
                }
            }
        }
    }
    
    println!("  ✓ Deleted {} local image file(s)", local_deleted_count);
    
    // Delete image files from S3 (if configured)
    let image_storage = std::env::var("IMAGE_STORAGE").unwrap_or_else(|_| "local".to_string());
    let use_s3 = image_storage == "s3" || image_storage == "both";
    
    if use_s3 {
        println!();
        println!("Deleting S3 image files...");
        
        if let Some(s3_client) = create_s3_client().await {
            if let Some(bucket) = std::env::var("S3_IMAGE_BUCKET").ok() {
                match delete_s3_images(&s3_client, &bucket).await {
                    Ok(count) => {
                        println!("  ✓ Deleted {} S3 image file(s)", count);
                    }
                    Err(e) => {
                        eprintln!("  ✗ Error deleting S3 images: {}", e);
                    }
                }
            } else {
                println!("  ⚠ S3_IMAGE_BUCKET not configured, skipping S3 deletion");
            }
        } else {
            println!("  ⚠ S3 not configured, skipping S3 deletion");
        }
    }
    
    println!();
    println!("Next steps:");
    println!("  1. Run: ./index [MUSIC_DIR]");
    println!("  2. Run: ./sync");
}
