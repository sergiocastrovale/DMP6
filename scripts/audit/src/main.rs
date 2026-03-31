use chrono::Utc;
use clap::Parser;
use colored::*;
use dotenvy;
use rust_xlsxwriter::{Format, FormatBorder, Workbook, Worksheet, XlsxError};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-audit", about = "Audit DMP database for data quality issues")]
struct Args {
    /// Output file path (default: reports/audit-YYYY-MM-DD.xlsx)
    #[arg(short, long)]
    output: Option<String>,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct Config {
    database_url: String,
    project_root: String,
    music_dir: String,
}

fn load_config() -> Config {
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

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");

    let project_root = std::env::var("PROJECT_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .ok()
            .and_then(|d| {
                if d.ends_with("scripts/audit") {
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

    let music_dir = std::env::var("MUSIC_DIR").unwrap_or_default();

    Config {
        database_url,
        project_root,
        music_dir,
    }
}

// ---------------------------------------------------------------------------
// Path splitting: "Artist/Albums/1999 - Moon Safari/CD 2" → columns
// ---------------------------------------------------------------------------

fn split_path(folder_path: &str, music_dir: &str) -> Vec<String> {
    let relative = folder_path
        .strip_prefix(music_dir)
        .unwrap_or(folder_path)
        .trim_start_matches('/');
    relative.split('/').map(|s| s.to_string()).collect()
}

fn max_depth(paths: &[Vec<String>]) -> usize {
    paths.iter().map(|p| p.len()).max().unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Sheet writer helper
// ---------------------------------------------------------------------------

struct SheetWriter {
    total_issues: u32,
}

impl SheetWriter {
    fn new() -> Self {
        Self { total_issues: 0 }
    }

    fn write_header(
        &self,
        sheet: &mut Worksheet,
        header_fmt: &Format,
        extra_cols: &[&str],
        path_depth: usize,
    ) -> Result<(), XlsxError> {
        let mut col = 0u16;

        // Path columns
        for i in 0..path_depth {
            let name = match i {
                0 => "Artist".to_string(),
                _ => format!("Path {}", i + 1),
            };
            sheet.write_string_with_format(0, col, name.as_str(), header_fmt)?;
            sheet.set_column_width(col, 25)?;
            col += 1;
        }

        // Extra data columns
        for name in extra_cols {
            sheet.write_string_with_format(0, col, *name, header_fmt)?;
            sheet.set_column_width(col, 30)?;
            col += 1;
        }

        sheet.set_freeze_panes(1, 0)?;
        Ok(())
    }

    fn write_path_row(
        &self,
        sheet: &mut Worksheet,
        row: u32,
        path_parts: &[String],
        path_depth: usize,
        extra_values: &[&str],
    ) -> Result<(), XlsxError> {
        let mut col = 0u16;

        for i in 0..path_depth {
            let val = path_parts.get(i).map(|s| s.as_str()).unwrap_or("");
            sheet.write_string(row, col, val.to_string())?;
            col += 1;
        }

        for val in extra_values {
            sheet.write_string(row, col, *val)?;
            col += 1;
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Audit checks
// ---------------------------------------------------------------------------

/// Artists that look like duplicates (same name, different slug/case)
async fn check_duplicate_artists(
    pool: &PgPool,
) -> Result<Vec<(String, String, String, String)>, sqlx::Error> {
    // Find artists with similar names (case-insensitive match, different IDs)
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT a1.name, a1.slug, a2.name, a2.slug
           FROM "Artist" a1
           JOIN "Artist" a2 ON LOWER(REPLACE(a1.name, ' ', '')) = LOWER(REPLACE(a2.name, ' ', ''))
             AND a1.id < a2.id
           ORDER BY a1.name"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Artists with 0 releases (orphaned)
async fn check_orphan_artists(
    pool: &PgPool,
) -> Result<Vec<(String, String, i32)>, sqlx::Error> {
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        r#"SELECT a.name, a.slug, a."totalTracks"
           FROM "Artist" a
           LEFT JOIN "LocalReleaseArtist" lra ON a.id = lra."artistId"
           WHERE lra.id IS NULL
           ORDER BY a.name"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Releases with 0 tracks
async fn check_empty_releases(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<String>), sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT lr.title, lr."folderPath"
           FROM "LocalRelease" lr
           LEFT JOIN "LocalReleaseTrack" lrt ON lr.id = lrt."localReleaseId"
           WHERE lrt.id IS NULL
           ORDER BY lr."folderPath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut titles = Vec::new();
    for (title, fp) in rows {
        paths.push(split_path(fp.as_deref().unwrap_or(""), music_dir));
        titles.push(title);
    }
    Ok((paths, titles))
}

/// Releases with no cover art (no image and no imageUrl)
async fn check_releases_no_art(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<String>), sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT lr.title, lr."folderPath"
           FROM "LocalRelease" lr
           WHERE lr.image IS NULL AND lr."imageUrl" IS NULL
           ORDER BY lr."folderPath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut titles = Vec::new();
    for (title, fp) in rows {
        paths.push(split_path(fp.as_deref().unwrap_or(""), music_dir));
        titles.push(title);
    }
    Ok((paths, titles))
}

/// Artists with no MusicBrainz match
async fn check_artists_no_mb(
    pool: &PgPool,
) -> Result<Vec<(String, String, i32, i64)>, sqlx::Error> {
    let rows: Vec<(String, String, i32, i64)> = sqlx::query_as(
        r#"SELECT a.name, a.slug, a."totalTracks",
                  (SELECT COUNT(*) FROM "LocalReleaseArtist" lra WHERE lra."artistId" = a.id)::bigint
           FROM "Artist" a
           WHERE a."musicbrainzId" IS NULL
             AND a."totalTracks" > 0
           ORDER BY a."totalTracks" DESC"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Releases with very low match scores (< 50%)
async fn check_low_match_scores(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<(String, String, String)>), sqlx::Error> {
    let rows: Vec<(String, Option<String>, String, String)> = sqlx::query_as(
        r#"SELECT lr.title, lr."folderPath", lr."matchStatus"::text,
                  COALESCE(a.name, 'Unknown')
           FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
           JOIN "Artist" a ON lra."artistId" = a.id
           WHERE lr."matchStatus" = 'INCOMPLETE'
           ORDER BY lr."folderPath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut details = Vec::new();
    for (title, fp, status, artist) in rows {
        paths.push(split_path(fp.as_deref().unwrap_or(""), music_dir));
        details.push((title, status, artist));
    }
    Ok((paths, details))
}

/// Releases with MISSING status (in MB but not on disk)
async fn check_missing_releases(
    pool: &PgPool,
) -> Result<Vec<(String, String, String, Option<i32>)>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<i32>)> = sqlx::query_as(
        r#"SELECT mbr.title, a.name, rt.name, mbr.year
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mbra ON mbr.id = mbra."releaseId"
           JOIN "Artist" a ON mbra."artistId" = a.id
           JOIN "ReleaseType" rt ON mbr."typeId" = rt.id
           WHERE mbr.status = 'MISSING'
           ORDER BY a.name, mbr.title"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Tracks with no release assignment
async fn check_orphan_tracks(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<(String, String)>), sqlx::Error> {
    let rows: Vec<(Option<String>, String, Option<String>)> = sqlx::query_as(
        r#"SELECT lrt.title, lrt."filePath", lrt.artist
           FROM "LocalReleaseTrack" lrt
           WHERE lrt."localReleaseId" IS NULL
           ORDER BY lrt."filePath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut details = Vec::new();
    for (title, file_path, artist) in rows {
        // Split the file path (strip filename, keep folder parts)
        let folder = file_path.rsplitn(2, '/').nth(1).unwrap_or("");
        paths.push(split_path(folder, music_dir));
        details.push((
            title.unwrap_or_default(),
            artist.unwrap_or_default(),
        ));
    }
    Ok((paths, details))
}

/// Releases linked to only 1 artist but containing multi-artist tags
async fn check_multi_artist_tags_single_link(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<(String, String)>), sqlx::Error> {
    let rows: Vec<(String, Option<String>, String)> = sqlx::query_as(
        r#"SELECT DISTINCT lr.title, lr."folderPath", lrt."albumArtist"
           FROM "LocalRelease" lr
           JOIN "LocalReleaseTrack" lrt ON lr.id = lrt."localReleaseId"
           JOIN (
               SELECT "localReleaseId"
               FROM "LocalReleaseArtist"
               GROUP BY "localReleaseId"
               HAVING COUNT(*) = 1
           ) singles ON lr.id = singles."localReleaseId"
           WHERE lrt."albumArtist" IS NOT NULL
             AND (lrt."albumArtist" LIKE '%/%'
               OR lrt."albumArtist" LIKE '%;%'
               OR lrt."albumArtist" LIKE '%|%'
               OR lrt."albumArtist" LIKE '%\%'
               OR lrt."albumArtist" LIKE '%feat.%'
               OR lrt."albumArtist" LIKE '%feat %'
               OR lrt."albumArtist" LIKE '%ft.%'
               OR lrt."albumArtist" LIKE '%,%')
           ORDER BY lr."folderPath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut details = Vec::new();
    for (title, fp, album_artist) in rows {
        paths.push(split_path(fp.as_deref().unwrap_or(""), music_dir));
        details.push((title, album_artist));
    }
    Ok((paths, details))
}

/// Artists with no cover art
async fn check_artists_no_art(
    pool: &PgPool,
) -> Result<Vec<(String, String, i32)>, sqlx::Error> {
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        r#"SELECT a.name, a.slug, a."totalTracks"
           FROM "Artist" a
           WHERE a.image IS NULL AND a."imageUrl" IS NULL
             AND a."totalTracks" > 0
           ORDER BY a."totalTracks" DESC"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Tracks with suspicious metadata (missing title, artist, or album)
async fn check_incomplete_metadata(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<(String, String, String)>), sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT lrt."filePath", lrt.title, lrt.artist, lrt.album
           FROM "LocalReleaseTrack" lrt
           WHERE lrt.title IS NULL
              OR lrt.artist IS NULL
              OR lrt.album IS NULL
           ORDER BY lrt."filePath"
           LIMIT 5000"#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut details = Vec::new();
    for (file_path, title, artist, album) in rows {
        let folder = file_path.rsplitn(2, '/').nth(1).unwrap_or("");
        paths.push(split_path(folder, music_dir));
        let mut missing = Vec::new();
        if title.is_none() { missing.push("title"); }
        if artist.is_none() { missing.push("artist"); }
        if album.is_none() { missing.push("album"); }
        details.push((
            title.unwrap_or_else(|| "(no title)".to_string()),
            artist.unwrap_or_else(|| "(no artist)".to_string()),
            missing.join(", "),
        ));
    }
    Ok((paths, details))
}

/// Releases with EXTRA_TRACKS status
async fn check_extra_tracks(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(Vec<Vec<String>>, Vec<(String, String)>), sqlx::Error> {
    let rows: Vec<(String, Option<String>, String)> = sqlx::query_as(
        r#"SELECT lr.title, lr."folderPath", COALESCE(a.name, 'Unknown')
           FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
           JOIN "Artist" a ON lra."artistId" = a.id
           WHERE lr."matchStatus" = 'EXTRA_TRACKS'
           ORDER BY lr."folderPath""#,
    )
    .fetch_all(pool)
    .await?;

    let mut paths = Vec::new();
    let mut details = Vec::new();
    for (title, fp, artist) in rows {
        paths.push(split_path(fp.as_deref().unwrap_or(""), music_dir));
        details.push((title, artist));
    }
    Ok((paths, details))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let config = load_config();

    println!("{}", "DMP Audit".bright_cyan().bold());
    println!("{}", "=========".bright_black());
    println!();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    let music_dir = config.music_dir.trim_end_matches('/');
    let now = Utc::now();
    let mut writer = SheetWriter::new();

    // --- Output path ---
    let output_path = args.output.unwrap_or_else(|| {
        let reports_dir = PathBuf::from(&config.project_root).join("reports");
        std::fs::create_dir_all(&reports_dir).ok();
        reports_dir
            .join(format!("audit-{}.xlsx", now.format("%Y-%m-%d")))
            .to_string_lossy()
            .to_string()
    });

    println!("Output: {}", output_path.bright_white());
    println!();

    let mut workbook = Workbook::new();

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(rust_xlsxwriter::Color::RGB(0x4472C4))
        .set_font_color(rust_xlsxwriter::Color::White)
        .set_border_bottom(FormatBorder::Thin);

    // =========================================================================
    // 1. Duplicate-looking artists
    // =========================================================================
    print!("  Checking duplicate artists...");
    match check_duplicate_artists(&pool).await {
        Ok(rows) => {
            let count = rows.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let sheet = workbook.add_worksheet();
                sheet.set_name("Duplicate Artists")?;
                writer.write_header(sheet, &header_fmt, &["Artist A", "Slug A", "Artist B", "Slug B"], 0)?;
                for (i, (name_a, slug_a, name_b, slug_b)) in rows.iter().enumerate() {
                    let row = (i + 1) as u32;
                    sheet.write_string(row, 0, name_a)?;
                    sheet.write_string(row, 1, slug_a)?;
                    sheet.write_string(row, 2, name_b)?;
                    sheet.write_string(row, 3, slug_b)?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 2. Orphan artists (no releases)
    // =========================================================================
    print!("  Checking orphan artists...");
    match check_orphan_artists(&pool).await {
        Ok(rows) => {
            let count = rows.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let sheet = workbook.add_worksheet();
                sheet.set_name("Orphan Artists")?;
                writer.write_header(sheet, &header_fmt, &["Artist", "Slug", "Tracks (stale)"], 0)?;
                for (i, (name, slug, tracks)) in rows.iter().enumerate() {
                    let row = (i + 1) as u32;
                    sheet.write_string(row, 0, name)?;
                    sheet.write_string(row, 1, slug)?;
                    sheet.write_number(row, 2, *tracks as f64)?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 3. Artists with no MusicBrainz match
    // =========================================================================
    print!("  Checking artists without MB match...");
    match check_artists_no_mb(&pool).await {
        Ok(rows) => {
            let count = rows.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let sheet = workbook.add_worksheet();
                sheet.set_name("No MB Match")?;
                writer.write_header(sheet, &header_fmt, &["Artist", "Slug", "Tracks", "Releases"], 0)?;
                for (i, (name, slug, tracks, releases)) in rows.iter().enumerate() {
                    let row = (i + 1) as u32;
                    sheet.write_string(row, 0, name)?;
                    sheet.write_string(row, 1, slug)?;
                    sheet.write_number(row, 2, *tracks as f64)?;
                    sheet.write_number(row, 3, *releases as f64)?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 4. Artists with no cover art
    // =========================================================================
    print!("  Checking artists without cover art...");
    match check_artists_no_art(&pool).await {
        Ok(rows) => {
            let count = rows.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let sheet = workbook.add_worksheet();
                sheet.set_name("Artists No Art")?;
                writer.write_header(sheet, &header_fmt, &["Artist", "Slug", "Tracks"], 0)?;
                for (i, (name, slug, tracks)) in rows.iter().enumerate() {
                    let row = (i + 1) as u32;
                    sheet.write_string(row, 0, name)?;
                    sheet.write_string(row, 1, slug)?;
                    sheet.write_number(row, 2, *tracks as f64)?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 5. Empty releases (0 tracks)
    // =========================================================================
    print!("  Checking empty releases...");
    match check_empty_releases(&pool, music_dir).await {
        Ok((paths, titles)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Empty Releases")?;
                writer.write_header(sheet, &header_fmt, &["Release Title"], depth)?;
                for (i, (path, title)) in paths.iter().zip(titles.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 6. Releases with no cover art
    // =========================================================================
    print!("  Checking releases without cover art...");
    match check_releases_no_art(&pool, music_dir).await {
        Ok((paths, titles)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Releases No Art")?;
                writer.write_header(sheet, &header_fmt, &["Release Title"], depth)?;
                for (i, (path, title)) in paths.iter().zip(titles.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 7. Incomplete releases (some MB tracks missing locally)
    // =========================================================================
    print!("  Checking incomplete releases...");
    match check_low_match_scores(&pool, music_dir).await {
        Ok((paths, details)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Incomplete Releases")?;
                writer.write_header(sheet, &header_fmt, &["Release Title", "Status", "Artist"], depth)?;
                for (i, (path, (title, status, artist))) in paths.iter().zip(details.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title, status, artist])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 8. Extra tracks (more local tracks than MB)
    // =========================================================================
    print!("  Checking releases with extra tracks...");
    match check_extra_tracks(&pool, music_dir).await {
        Ok((paths, details)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Extra Tracks")?;
                writer.write_header(sheet, &header_fmt, &["Release Title", "Artist"], depth)?;
                for (i, (path, (title, artist))) in paths.iter().zip(details.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title, artist])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 9. Missing releases (in MB but not on disk)
    // =========================================================================
    print!("  Checking missing releases...");
    match check_missing_releases(&pool).await {
        Ok(rows) => {
            let count = rows.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let sheet = workbook.add_worksheet();
                sheet.set_name("Missing Releases")?;
                writer.write_header(sheet, &header_fmt, &["Release", "Artist", "Type", "Year"], 0)?;
                for (i, (title, artist, rtype, year)) in rows.iter().enumerate() {
                    let row = (i + 1) as u32;
                    sheet.write_string(row, 0, title)?;
                    sheet.write_string(row, 1, artist)?;
                    sheet.write_string(row, 2, rtype)?;
                    match year {
                        Some(y) => { sheet.write_number(row, 3, *y as f64)?; }
                        None => { sheet.write_string(row, 3, "")?; }
                    }
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 10. Orphan tracks (no release)
    // =========================================================================
    print!("  Checking orphan tracks...");
    match check_orphan_tracks(&pool, music_dir).await {
        Ok((paths, details)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Orphan Tracks")?;
                writer.write_header(sheet, &header_fmt, &["Track Title", "Artist"], depth)?;
                for (i, (path, (title, artist))) in paths.iter().zip(details.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title, artist])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 11. Multi-artist tags on single-linked releases
    // =========================================================================
    print!("  Checking unsplit multi-artist tags...");
    match check_multi_artist_tags_single_link(&pool, music_dir).await {
        Ok((paths, details)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Unsplit Multi-Artist")?;
                writer.write_header(sheet, &header_fmt, &["Release Title", "Album Artist Tag"], depth)?;
                for (i, (path, (title, album_artist))) in paths.iter().zip(details.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title, album_artist])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // 12. Incomplete metadata (missing title, artist, or album)
    // =========================================================================
    print!("  Checking incomplete track metadata...");
    match check_incomplete_metadata(&pool, music_dir).await {
        Ok((paths, details)) => {
            let count = paths.len();
            writer.total_issues += count as u32;
            println!(" {}", if count > 0 { count.to_string().yellow() } else { "0".bright_black() });

            if count > 0 {
                let depth = max_depth(&paths);
                let sheet = workbook.add_worksheet();
                sheet.set_name("Incomplete Metadata")?;
                writer.write_header(sheet, &header_fmt, &["Track Title", "Artist", "Missing Fields"], depth)?;
                for (i, (path, (title, artist, missing))) in paths.iter().zip(details.iter()).enumerate() {
                    writer.write_path_row(sheet, (i + 1) as u32, path, depth, &[title, artist, missing])?;
                }
            }
        }
        Err(e) => println!(" {} {}", "error".red(), e),
    }

    // =========================================================================
    // Save
    // =========================================================================
    println!();

    workbook.save(&output_path)?;
    println!(
        "{} Saved {} ({} total issues across all checks)",
        "Done!".green().bold(),
        output_path.bright_white(),
        writer.total_issues.to_string().bright_yellow()
    );

    Ok(())
}
