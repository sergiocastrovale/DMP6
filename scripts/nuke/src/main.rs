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
        PathBuf::from("/home/kp/web/DMPv6/web/.env"),
    ];

    for p in &env_paths {
        if p.exists() {
            dotenvy::from_path(p).ok();
            break;
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
    
    // Delete image files
    println!();
    println!("Deleting image files...");
    
    let image_dirs = vec![
        PathBuf::from("web/public/img/releases"),
        PathBuf::from("../../web/public/img/releases"),
        PathBuf::from("/home/kp/web/DMPv6/web/public/img/releases"),
        PathBuf::from("web/public/img/artists"),
        PathBuf::from("../../web/public/img/artists"),
        PathBuf::from("/home/kp/web/DMPv6/web/public/img/artists"),
    ];
    
    let mut deleted_count = 0;
    
    for dir in &image_dirs {
        if !dir.exists() {
            continue;
        }
        
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                    if fs::remove_file(&path).is_ok() {
                        deleted_count += 1;
                    }
                }
            }
        }
    }
    
    println!("  ✓ Deleted {} image file(s)", deleted_count);
    
    println!();
    println!("Next steps:");
    println!("  1. Run: ./index [MUSIC_DIR]");
    println!("  2. Run: ./sync");
}
