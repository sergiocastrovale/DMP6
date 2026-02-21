use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use chrono::Utc;
use clap::Parser;
use colored::*;
use dotenvy;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::fs;
use std::io::Write as IoWrite;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-clean", about = "Clean up orphaned images from S3 and local storage")]
struct Args {
    /// Dry run - show what would be deleted without actually deleting
    #[arg(long)]
    dry_run: bool,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

struct CleanConfig {
    database_url: String,
    project_root: String,
    image_storage: String,
    S3_IMAGE_BUCKET: Option<String>,
    AWS_REGION: Option<String>,
    s3_access_key: Option<String>,
    s3_secret_key: Option<String>,
    s3_endpoint: Option<String>,
}

fn load_config() -> CleanConfig {
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

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");
    
    let project_root = std::env::var("PROJECT_ROOT")
        .unwrap_or_else(|_| {
            // Try to detect project root from current directory
            std::env::current_dir()
                .ok()
                .and_then(|d| {
                    // If we're in scripts/clean, go up two levels
                    if d.ends_with("scripts/clean") {
                        d.parent().and_then(|p| p.parent()).map(|p| p.to_string_lossy().to_string())
                    } else if d.ends_with("scripts") {
                        d.parent().map(|p| p.to_string_lossy().to_string())
                    } else {
                        Some(d.to_string_lossy().to_string())
                    }
                })
                .unwrap_or_else(|| ".".to_string())
        });
    
    let image_storage = std::env::var("IMAGE_STORAGE").unwrap_or_else(|_| "local".to_string());
    let S3_IMAGE_BUCKET = std::env::var("S3_IMAGE_BUCKET").ok();
    let AWS_REGION = std::env::var("AWS_REGION").ok();
    let s3_access_key = std::env::var("AWS_ACCESS_KEY_ID").ok();
    let s3_secret_key = std::env::var("AWS_SECRET_ACCESS_KEY").ok();
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty());

    CleanConfig {
        database_url,
        project_root,
        image_storage,
        S3_IMAGE_BUCKET,
        AWS_REGION,
        s3_access_key,
        s3_secret_key,
        s3_endpoint,
    }
}

// ---------------------------------------------------------------------------
// S3 Client
// ---------------------------------------------------------------------------

async fn create_s3_client(config: &CleanConfig) -> Option<S3Client> {
    if config.S3_IMAGE_BUCKET.is_none() || config.AWS_REGION.is_none() {
        return None;
    }
    
    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());
    
    if let Some(ref region) = config.AWS_REGION {
        aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    }
    
    if let (Some(ref key), Some(ref secret)) = (&config.s3_access_key, &config.s3_secret_key) {
        aws_config = aws_config.credentials_provider(
            aws_sdk_s3::config::Credentials::new(
                key,
                secret,
                None,
                None,
                "dmp-clean"
            )
        );
    }
    
    let aws_config = aws_config.load().await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&aws_config);
    
    if let Some(ref endpoint) = config.s3_endpoint {
        s3_config = s3_config.endpoint_url(endpoint);
    }
    
    Some(S3Client::from_conf(s3_config.build()))
}

// ---------------------------------------------------------------------------
// Deletion Functions
// ---------------------------------------------------------------------------

async fn delete_from_s3(
    client: &S3Client,
    bucket: &str,
    object_key: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    client
        .delete_object()
        .bucket(bucket)
        .key(object_key)
        .send()
        .await?;
    
    Ok(())
}

fn delete_from_local(object_key: &str, config: &CleanConfig) -> Result<(), std::io::Error> {
    // Convert S3 key to local path using project_root
    let path = PathBuf::from(&config.project_root)
        .join("web/public/img")
        .join(object_key);

    if path.exists() {
        fs::remove_file(&path)?;
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("File not found: {}", path.display()),
        ))
    }
}

async fn remove_from_queue(pool: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "S3DeletionQueue" WHERE id = $1"#)
        .bind(id)
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

    println!("DMP Image Cleanup");
    println!("=================");
    if args.dry_run {
        println!("Mode: {} (no changes will be made)", "DRY RUN".yellow().bold());
    }
    println!();

    // Initialize error log
    let error_log = std::sync::Mutex::new(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("errors.log")
            .expect("Cannot open errors.log"),
    );

    let config = load_config();
    println!("Image storage: {}", config.image_storage);

    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let use_local = config.image_storage == "local" || config.image_storage == "both";

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    // Initialize S3 client if needed
    let s3_client = if use_s3 {
        match create_s3_client(&config).await {
            Some(client) => {
                println!("S3 client: {}", "✓ Initialized".green());
                Some(client)
            }
            None => {
                println!("S3 client: {} (S3 not configured)", "✗".yellow());
                if config.image_storage == "s3" {
                    eprintln!("\n{}: IMAGE_STORAGE is set to 's3' but S3 is not configured!", "Error".red().bold());
                    std::process::exit(1);
                }
                None
            }
        }
    } else {
        None
    };

    println!();

    // Fetch all pending deletions
    println!("Fetching deletion queue...");
    let queue_items: Vec<(String, String, chrono::NaiveDateTime)> = match sqlx::query_as(
        r#"SELECT id, "objectKey", "createdAt" FROM "S3DeletionQueue" ORDER BY "createdAt" ASC"#,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(items) => items,
        Err(e) => {
            eprintln!("{} Failed to fetch deletion queue: {}", "✗".red(), e);
            std::process::exit(1);
        }
    };

    if queue_items.is_empty() {
        println!("{} No images to clean up", "✓".green());
        return;
    }

    println!("  {} Found {} image(s) pending deletion", "→".bright_black(), queue_items.len());
    println!();

    let mut s3_deleted = 0;
    let mut local_deleted = 0;
    let mut s3_failed = 0;
    let mut local_failed = 0;
    let mut queue_removed = 0;

    let total_items = queue_items.len();

    for (id, object_key, created_at) in &queue_items {
        let age = (Utc::now().naive_utc() - *created_at).num_hours();
        
        print!("  {} {} (queued {}h ago)... ", 
            "→".bright_black(),
            object_key.bright_white(),
            age
        );
        std::io::stdout().flush().ok();

        if args.dry_run {
            println!("{} (dry run)", "○".cyan());
            continue;
        }

        let mut s3_success = false;
        let mut local_success = false;
        let mut any_success = false;

        // Delete from S3
        if use_s3 {
            if let (Some(ref client), Some(ref bucket)) = (&s3_client, &config.S3_IMAGE_BUCKET) {
                match delete_from_s3(client, bucket, &object_key).await {
                    Ok(_) => {
                        s3_success = true;
                        s3_deleted += 1;
                        any_success = true;
                    }
                    Err(e) => {
                        s3_failed += 1;
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[CLEAN] Failed to delete S3 object '{}': {}", object_key, e).ok();
                        }
                    }
                }
            }
        }

        // Delete from local storage
        if use_local {
            match delete_from_local(&object_key, &config) {
                Ok(_) => {
                    local_success = true;
                    local_deleted += 1;
                    any_success = true;
                }
                Err(e) => {
                    // Don't count as failure if file simply doesn't exist
                    if e.kind() != std::io::ErrorKind::NotFound {
                        local_failed += 1;
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[CLEAN] Failed to delete local file '{}': {}", object_key, e).ok();
                        }
                    }
                }
            }
        }

        // Print result
        if any_success {
            let mut parts = Vec::new();
            if s3_success {
                parts.push("S3".to_string());
            }
            if local_success {
                parts.push("local".to_string());
            }
            println!("{} {}", "✓".green(), parts.join(" + ").bright_black());

            // Remove from queue
            if remove_from_queue(&pool, &id).await.is_ok() {
                queue_removed += 1;
            }
        } else {
            println!("{} Failed", "✗".red());
        }
    }

    // Summary
    println!();
    println!("════════════════════════════════════════════════════════════");
    println!();
    
    if args.dry_run {
        println!("{} {} image(s) would be deleted", 
            "Dry run:".cyan().bold(),
            total_items
        );
    } else {
        println!("Summary:");
        if use_s3 {
            println!("  S3       : {} deleted, {} failed", 
                format!("{}", s3_deleted).green(),
                if s3_failed > 0 { format!("{}", s3_failed).red().to_string() } else { "0".to_string() }
            );
        }
        if use_local {
            println!("  Local    : {} deleted, {} failed", 
                format!("{}", local_deleted).green(),
                if local_failed > 0 { format!("{}", local_failed).red().to_string() } else { "0".to_string() }
            );
        }
        println!("  Queue    : {} removed", format!("{}", queue_removed).green());
        
        if s3_failed > 0 || local_failed > 0 {
            println!();
            println!("{}: Check errors.log for details", "Note".yellow());
        }
    }
}
