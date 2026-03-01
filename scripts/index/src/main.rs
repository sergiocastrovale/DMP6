use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client as S3Client;
use chrono::{NaiveDateTime, Utc};
use clap::Parser;
use colored::*;
use lofty::config::ParseOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use md5::{Digest, Md5};
use rayon::prelude::*;
use regex::Regex;
use serde_json::Value as JsonValue;
use slug::slugify;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::fs;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-index", about = "Index local audio files into the DMP database")]
struct Args {
    /// Override MUSIC_DIR from .env
    #[arg()]
    music_dir: Option<String>,

    /// Nuke matching data, then re-index from scratch
    #[arg(long)]
    overwrite: bool,

    /// Folders starting from prefix (case insensitive)
    #[arg(long, default_value = "")]
    from: String,

    /// Folders up to prefix (case insensitive)
    #[arg(long, default_value = "")]
    to: String,

    /// Folders starting with prefix (case insensitive)
    #[arg(long, default_value = "")]
    only: String,

    /// Continue from last checkpoint
    #[arg(long)]
    resume: bool,

    /// Skip cover art extraction
    #[arg(long)]
    skip_images: bool,

    /// Number of parallel workers (default: all cores)
    #[arg(long, default_value = "0")]
    threads: usize,

    /// Limit to first N files (0 = no limit)
    #[arg(long, default_value = "0")]
    limit: usize,
}

// ---------------------------------------------------------------------------
// Extracted metadata from a single file
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct TrackMeta {
    file_path: String,
    file_size: i64,
    mtime: NaiveDateTime,
    title: Option<String>,
    artist: Option<String>,
    album_artist: Option<String>,
    album: Option<String>,
    year: Option<i32>,
    genre: Option<String>,
    track_number: Option<i32>,
    disc_number: Option<i32>,
    duration: Option<i32>,
    bitrate: Option<i32>,
    sample_rate: Option<i32>,
    position: Option<String>,
    content_hash: String,
    metadata_json: JsonValue,
    has_picture: bool,
}

// ---------------------------------------------------------------------------
// Config from .env
// ---------------------------------------------------------------------------

struct Config {
    music_dir: String,
    database_url: String,
    project_root: String,
    image_storage: String,
    s3_bucket: Option<String>,
    s3_region: Option<String>,
    s3_access_key: Option<String>,
    s3_secret_key: Option<String>,
    s3_endpoint: Option<String>,
    s3_public_url: Option<String>,
}

fn load_config(music_dir_override: &Option<String>) -> Config {
    // Try loading from web/.env relative to the binary or cwd
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

    let music_dir = music_dir_override
        .clone()
        .or_else(|| std::env::var("MUSIC_DIR").ok())
        .expect("MUSIC_DIR not set. Pass as argument or set in web/.env");

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");
    
    let project_root = std::env::var("PROJECT_ROOT")
        .unwrap_or_else(|_| {
            // Try to detect project root from current directory
            std::env::current_dir()
                .ok()
                .and_then(|d| {
                    // If we're in scripts/index, go up two levels
                    if d.ends_with("scripts/index") {
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
    let s3_bucket = std::env::var("S3_IMAGE_BUCKET").ok();
    let s3_region = std::env::var("AWS_REGION").ok();
    let s3_access_key = std::env::var("AWS_ACCESS_KEY_ID").ok();
    let s3_secret_key = std::env::var("AWS_SECRET_ACCESS_KEY").ok();
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty());
    let s3_public_url = std::env::var("S3_PUBLIC_URL").ok();

    Config {
        music_dir,
        database_url,
        project_root,
        image_storage,
        s3_bucket,
        s3_region,
        s3_access_key,
        s3_secret_key,
        s3_endpoint,
        s3_public_url,
    }
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

/// Strip characters that PostgreSQL JSON rejects: null bytes and C0/C1 control characters.
/// serde_json serialises \0 as \u0000 which Postgres refuses in jsonb columns.
fn sanitize_tag(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '\0' && !('\x01'..='\x1F').contains(&c) && !('\u{007F}'..='\u{009F}').contains(&c))
        .collect()
}

fn extract_metadata(path: &Path, music_dir: &str) -> Option<TrackMeta> {
    let meta = fs::metadata(path).ok()?;
    let file_size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
            chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)
                .map(|dt| dt.naive_utc())
        })
        .unwrap_or_else(|| Utc::now().naive_utc());

    let parse_opts = ParseOptions::new().read_properties(true);
    let tagged_file = Probe::open(path).ok()?.options(parse_opts).read().ok()?;

    // Collect standard tags
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album_artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut year: Option<i32> = None;
    let mut genre: Option<String> = None;
    let mut track_number: Option<i32> = None;
    let mut disc_number: Option<i32> = None;
    let mut position: Option<String> = None;
    let mut all_tags: HashMap<String, String> = HashMap::new();
    let mut has_picture = false;

    for tag in tagged_file.tags() {
        if title.is_none() {
            title = tag.title().map(|s| s.to_string());
        }
        if artist.is_none() {
            artist = tag.artist().map(|s| s.to_string());
        }
        if album.is_none() {
            album = tag.album().map(|s| s.to_string());
        }
        if year.is_none() {
            year = tag.year().and_then(|y| i32::try_from(y).ok());
        }
        if genre.is_none() {
            genre = tag.genre().map(|s| s.to_string());
        }
        if !tag.pictures().is_empty() {
            has_picture = true;
        }

        // Collect all raw items
        for item in tag.items() {
            let key = match item.key() {
                lofty::tag::ItemKey::Unknown(s) => s.to_string(),
                other => format!("{:?}", other),
            };
            if let lofty::tag::ItemValue::Text(raw_val) = item.value() {
                let val = sanitize_tag(raw_val);
                let key_upper = key.to_uppercase();

                // Extract specific fields from raw items
                if album_artist.is_none()
                    && (key_upper == "ALBUMARTIST"
                        || key_upper == "ALBUM_ARTIST"
                        || key_upper == "ALBUM ARTIST"
                        || key_upper.contains("ALBUMARTIST"))
                {
                    album_artist = Some(val.clone());
                }
                if track_number.is_none()
                    && (key_upper == "TRACKNUMBER" || key_upper == "TRACK")
                {
                    track_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if disc_number.is_none()
                    && (key_upper == "DISCNUMBER" || key_upper == "DISC")
                {
                    disc_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if position.is_none() && key_upper == "POSITION" {
                    position = Some(val.clone());
                }

                all_tags.insert(key, val.clone());
            }
        }
    }

    // Properties (duration, bitrate, sample rate)
    let props = tagged_file.properties();
    let duration = Some(props.duration().as_secs() as i32);
    let bitrate = props.audio_bitrate().map(|b| b as i32);
    let sample_rate = props.sample_rate().map(|s| s as i32);

    // Compute content hash
    let hash_input = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        artist.as_deref().unwrap_or("").to_lowercase(),
        album_artist.as_deref().unwrap_or("").to_lowercase(),
        album.as_deref().unwrap_or("").to_lowercase(),
        title.as_deref().unwrap_or("").to_lowercase(),
        year.unwrap_or(0),
        track_number.unwrap_or(0),
        disc_number.unwrap_or(0),
        genre.as_deref().unwrap_or("").to_lowercase(),
    );
    let mut hasher = Md5::new();
    hasher.update(hash_input.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());

    // Build metadata JSON (exclude fields that have their own columns)
    let excluded_keys: Vec<&str> = vec![
        "ARTIST", "TITLE", "ALBUM", "YEAR", "DATE", "GENRE",
        "TRACKNUMBER", "TRACK", "DISCNUMBER", "DISC", "ALBUMARTIST",
        "ALBUM_ARTIST", "ALBUM ARTIST",
    ];
    let mut meta_map = serde_json::Map::new();
    for (k, v) in &all_tags {
        let k_upper = k.to_uppercase();
        if !excluded_keys.iter().any(|e| k_upper == *e) && !v.trim().is_empty() {
            meta_map.insert(k.clone(), JsonValue::String(v.clone()));
        }
    }
    let metadata_json = JsonValue::Object(meta_map);

    // Store relative path from music_dir
    let path_str = path.to_string_lossy();
    let relative_path = path_str
        .strip_prefix(music_dir)
        .unwrap_or(&path_str)
        .trim_start_matches('/')
        .to_string();

    Some(TrackMeta {
        file_path: relative_path,
        file_size,
        mtime,
        title,
        artist,
        album_artist,
        album,
        year,
        genre,
        track_number,
        disc_number,
        duration,
        bitrate,
        sample_rate,
        position,
        content_hash,
        metadata_json,
        has_picture,
    })
}

// ---------------------------------------------------------------------------
// Path helpers (same as analysis script)
// ---------------------------------------------------------------------------

fn get_artist_folder(path: &Path, scan_root: &str) -> String {
    let path_str = path.to_string_lossy();
    let relative = path_str
        .strip_prefix(scan_root)
        .unwrap_or(&path_str)
        .trim_start_matches('/');
    relative.split('/').next().unwrap_or("").to_string()
}

fn matches_filter(folder: &str, from: &str, to: &str, only: &str) -> bool {
    let folder_lower = folder.to_lowercase();

    if !only.is_empty() {
        return folder_lower.starts_with(only);
    }

    if !from.is_empty() && folder_lower < from.to_string() {
        return false;
    }
    if !to.is_empty() {
        let to_upper = format!("{}\u{10FFFF}", to);
        if folder_lower > to_upper {
            return false;
        }
    }

    true
}

// ---------------------------------------------------------------------------
// Artist tag splitting
// ---------------------------------------------------------------------------

/// Check if a name is a "Various Artists" variant that should be skipped.
fn is_various_artists(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "various artists" || lower == "various" || lower == "va"
}

/// Split an artist tag into individual artist names.
/// Returns (main_artists, featured_artists).
///
/// Splitting rules:
/// - Splits on "feat."/"ft."/"featuring" (case-insensitive) first to separate featured artists
/// - Then splits each side by "/" and ";"
/// - Splits on "," ONLY when not followed by a space or digit:
///   - Catches "Artist A,Artist B" (compact tagger format)
///   - Preserves "10,000 Maniacs" (digit after comma) and "Crosby, Stills & Nash" (space after comma)
/// - Does NOT split on "&" (too ambiguous: "Simon & Garfunkel")
/// - Trims whitespace, filters empties, deduplicates, skips "Various Artists" variants
fn split_artists(tag: &str) -> (Vec<String>, Vec<String>) {
    let feat_re = Regex::new(r"(?i)\s*\(\s*feat(?:uring)?\.?\s+|\s+feat(?:uring)?\.?\s+|\s*\(\s*ft\.?\s+|\s+ft\.?\s+").unwrap();

    // Split on featuring markers: left = main, right = featured
    let (main_part, feat_part) = if let Some(m) = feat_re.find(tag) {
        let main = &tag[..m.start()];
        let mut feat = &tag[m.end()..];
        // Strip trailing paren if the feat marker had an opening paren
        if tag[m.start()..m.end()].contains('(') {
            feat = feat.trim_end_matches(')').trim();
        }
        (main.to_string(), Some(feat.to_string()))
    } else {
        (tag.to_string(), None)
    };

    // Delimiters (checked longest-first so // and \\ and || beat their single-char forms):
    //   // \\ || / \ | ;   — always split
    //   ,                  — only when not followed by a space or digit
    //                        (preserves "10,000 Maniacs" and "Crosby, Stills & Nash")
    let split_part = |s: &str| -> Vec<String> {
        let mut parts: Vec<String> = Vec::new();
        let mut current = String::new();
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len();
        let mut i = 0;
        while i < len {
            let c = chars[i];
            // Check two-char delimiters first
            if i + 1 < len {
                let d = chars[i + 1];
                if (c == '/' && d == '/') || (c == '\\' && d == '\\') || (c == '|' && d == '|') {
                    parts.push(current.trim().to_string());
                    current = String::new();
                    i += 2;
                    continue;
                }
            }
            // Single-char delimiters
            if c == '/' || c == ';' || c == '\\' || c == '|' {
                parts.push(current.trim().to_string());
                current = String::new();
            } else if c == ',' {
                let next = chars.get(i + 1).copied();
                if next.map_or(false, |n| !n.is_whitespace() && !n.is_ascii_digit()) {
                    parts.push(current.trim().to_string());
                    current = String::new();
                } else {
                    current.push(c);
                }
            } else {
                current.push(c);
            }
            i += 1;
        }
        parts.push(current.trim().to_string());
        parts.into_iter()
            .filter(|p| !p.is_empty() && !is_various_artists(p))
            .collect()
    };

    let mut main_artists = split_part(&main_part);
    // Deduplicate while preserving order
    {
        let mut seen = std::collections::HashSet::new();
        main_artists.retain(|a| seen.insert(a.to_lowercase()));
    }

    let mut featured_artists = match feat_part {
        Some(ref fp) => split_part(fp),
        None => Vec::new(),
    };
    // Deduplicate featured, also excluding anyone already in main
    {
        let main_lower: std::collections::HashSet<String> =
            main_artists.iter().map(|a| a.to_lowercase()).collect();
        let mut seen = std::collections::HashSet::new();
        featured_artists.retain(|a| {
            let lower = a.to_lowercase();
            !main_lower.contains(&lower) && seen.insert(lower)
        });
    }

    (main_artists, featured_artists)
}

// ---------------------------------------------------------------------------
// Cover art extraction
// ---------------------------------------------------------------------------

fn extract_cover_art(path: &Path, output_path: &Path) -> bool {
    let parse_opts = ParseOptions::new().read_properties(false);
    let tagged_file = match Probe::open(path).ok().and_then(|p| p.options(parse_opts).read().ok()) {
        Some(f) => f,
        None => return false,
    };

    for tag in tagged_file.tags() {
        if let Some(pic) = tag.pictures().first() {
            let data: &[u8] = pic.data();
            // Load and resize to 200x200
            match image::load_from_memory(data) {
                Ok(img) => {
                    let resized = img.resize_to_fill(
                        200,
                        200,
                        image::imageops::FilterType::Lanczos3,
                    );
                    if let Some(parent) = output_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    match resized.save(output_path) {
                        Ok(_) => return true,
                        Err(_) => return false,
                    }
                }
                Err(_) => return false,
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// S3 Upload
// ---------------------------------------------------------------------------

async fn create_s3_client(config: &Config) -> Option<S3Client> {
    if config.s3_bucket.is_none() || config.s3_region.is_none() {
        return None;
    }
    
    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());
    
    if let Some(ref region) = config.s3_region {
        aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    }
    
    if let (Some(ref key), Some(ref secret)) = (&config.s3_access_key, &config.s3_secret_key) {
        aws_config = aws_config.credentials_provider(
            aws_sdk_s3::config::Credentials::new(
                key,
                secret,
                None,
                None,
                "dmp-static"
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

async fn upload_to_s3(
    client: &S3Client,
    bucket: &str,
    key: &str,
    file_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let body = ByteStream::from_path(file_path).await?;
    
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .content_type("image/jpeg")
        .send()
        .await?;
    
    Ok(())
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async fn ensure_artist(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let artist_slug = slugify(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }

    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE slug = $1"#,
    )
    .bind(&artist_slug)
    .fetch_optional(pool)
    .await?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "totalPlayCount", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 0, 0, 0, $4, $4)
           ON CONFLICT (slug) DO NOTHING"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&artist_slug)
    .bind(now)
    .execute(pool)
    .await?;

    // Return the actual ID (might be different if ON CONFLICT hit)
    let row: (String,) = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE slug = $1"#,
    )
    .bind(&artist_slug)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

/// Cached version of ensure_artist - checks HashMap before hitting DB
async fn ensure_artist_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    let artist_slug = slugify(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }

    if let Some(id) = cache.get(&artist_slug) {
        return Ok(id.clone());
    }

    let id = ensure_artist(pool, name).await?;
    if !id.is_empty() {
        cache.insert(artist_slug, id.clone());
    }
    Ok(id)
}

async fn ensure_local_release(
    pool: &PgPool,
    artist_id: &str,
    title: &str,
    year: Option<i32>,
    folder_path: Option<&str>,
) -> Result<String, sqlx::Error> {
    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "LocalRelease" WHERE "artistId" = $1 AND title = $2"#,
    )
    .bind(artist_id)
    .bind(title)
    .fetch_optional(pool)
    .await?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "artistId", "matchStatus", "forcedComplete", "totalPlayCount", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath")
           VALUES ($1, $2, $3, $4, 'UNKNOWN', false, 0, 0, 0, $5, $5, $6)
           ON CONFLICT ("artistId", title) DO UPDATE SET year = COALESCE($3, "LocalRelease".year), "updatedAt" = $5"#,
    )
    .bind(&id)
    .bind(title)
    .bind(year)
    .bind(artist_id)
    .bind(now)
    .bind(folder_path)
    .execute(pool)
    .await?;

    let row: (String,) = sqlx::query_as(
        r#"SELECT id FROM "LocalRelease" WHERE "artistId" = $1 AND title = $2"#,
    )
    .bind(artist_id)
    .bind(title)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

/// Cached version of ensure_local_release - checks HashMap before hitting DB
async fn ensure_local_release_cached(
    pool: &PgPool,
    artist_id: &str,
    title: &str,
    year: Option<i32>,
    folder_path: Option<&str>,
    cache: &mut HashMap<(String, String), String>,
) -> Result<String, sqlx::Error> {
    let key = (artist_id.to_string(), title.to_string());
    if let Some(id) = cache.get(&key) {
        return Ok(id.clone());
    }

    let id = ensure_local_release(pool, artist_id, title, year, folder_path).await?;
    cache.insert(key, id.clone());
    Ok(id)
}

async fn upsert_track(
    pool: &PgPool,
    track: &TrackMeta,
    local_release_id: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let metadata_value = serde_json::to_value(&track.metadata_json).unwrap_or(JsonValue::Null);

    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "playCount", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 0, $20, $20)
           ON CONFLICT ("filePath") DO UPDATE SET
             title = $2, artist = $3, "albumArtist" = $4, album = $5, year = $6,
             genre = $7, duration = $8, bitrate = $9, "sampleRate" = $10,
             position = $12, "trackNumber" = $13, "discNumber" = $14, "localReleaseId" = $15,
             "fileSize" = $16, mtime = $17, "contentHash" = $18, metadata = $19, "updatedAt" = $20
           RETURNING id"#,
    )
    .bind(&id)
    .bind(&track.title)
    .bind(&track.artist)
    .bind(&track.album_artist)
    .bind(&track.album)
    .bind(track.year)
    .bind(&track.genre)
    .bind(track.duration)
    .bind(track.bitrate)
    .bind(track.sample_rate)
    .bind(&track.file_path)
    .bind(&track.position)
    .bind(track.track_number)
    .bind(track.disc_number)
    .bind(local_release_id)
    .bind(track.file_size)
    .bind(track.mtime)
    .bind(&track.content_hash)
    .bind(&metadata_value)
    .bind(now)
    .fetch_one(pool)
    .await
    .map(|row| row.get::<String, _>("id"))
}

async fn ensure_track_artist(
    pool: &PgPool,
    track_id: &str,
    artist_id: &str,
    role: &str,
) -> Result<(), sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "TrackArtist" (id, "trackId", "artistId", role, "createdAt")
           VALUES ($1, $2, $3, $4::\"TrackArtistRole\", $5)
           ON CONFLICT ("trackId", "artistId", role) DO NOTHING"#,
    )
    .bind(&id)
    .bind(track_id)
    .bind(artist_id)
    .bind(role)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Overwrite / nuke
// ---------------------------------------------------------------------------

async fn nuke_artists(pool: &PgPool, from: &str, to: &str, only: &str) -> Result<u64, sqlx::Error> {
    // Find matching artists
    let artists: Vec<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, slug, image FROM "Artist""#,
    )
    .fetch_all(pool)
    .await?;

    let mut deleted = 0u64;
    for (artist_id, slug, image) in &artists {
        if !matches_filter(slug, from, to, only) {
            continue;
        }

        // Delete cover images for local releases
        let release_images: Vec<(Option<String>,)> = sqlx::query_as(
            r#"SELECT image FROM "LocalRelease" WHERE "artistId" = $1"#,
        )
        .bind(artist_id)
        .fetch_all(pool)
        .await?;

        for (img,) in &release_images {
            if let Some(img_path) = img {
                fs::remove_file(img_path).ok();
            }
        }

        // Delete artist image
        if let Some(img_path) = image {
            fs::remove_file(img_path).ok();
        }

        // Cascade delete the artist (will cascade to LocalRelease, LocalReleaseTrack, TrackArtist, ArtistUrl)
        sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#)
            .bind(artist_id)
            .execute(pool)
            .await?;

        deleted += 1;
    }

    Ok(deleted)
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

async fn save_checkpoint(
    pool: &PgPool,
    last_folder: &str,
    files_processed: i32,
    music_dir: &str,
    from: &str,
    to: &str,
    only: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "IndexCheckpoint" (id, "lastFolder", "filesProcessed", "musicDir", "filterFrom", "filterTo", "filterOnly", "createdAt", "updatedAt")
           VALUES ('main', $1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (id) DO UPDATE SET
             "lastFolder" = $1, "filesProcessed" = $2, "musicDir" = $3,
             "filterFrom" = $4, "filterTo" = $5, "filterOnly" = $6, "updatedAt" = $7"#,
    )
    .bind(last_folder)
    .bind(files_processed)
    .bind(music_dir)
    .bind(if from.is_empty() { None } else { Some(from) })
    .bind(if to.is_empty() { None } else { Some(to) })
    .bind(if only.is_empty() { None } else { Some(only) })
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_checkpoint(pool: &PgPool) -> Result<Option<(String, i32)>, sqlx::Error> {
    let row: Option<(Option<String>, i32)> = sqlx::query_as(
        r#"SELECT "lastFolder", "filesProcessed" FROM "IndexCheckpoint" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(folder, count)| (folder.unwrap_or_default(), count)))
}

async fn clear_checkpoint(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IndexCheckpoint" WHERE id = 'main'"#)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Post-processing: update release and artist totals
// ---------------------------------------------------------------------------

async fn update_release_totals(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "LocalRelease" lr SET
             "totalDuration" = sub.total_dur,
             "totalFileSize" = sub.total_size,
             "updatedAt" = NOW()
           FROM (
             SELECT "localReleaseId",
                    COALESCE(SUM(duration), 0) as total_dur,
                    COALESCE(SUM("fileSize"), 0) as total_size
             FROM "LocalReleaseTrack"
             WHERE "localReleaseId" IS NOT NULL
             GROUP BY "localReleaseId"
           ) sub
           WHERE lr.id = sub."localReleaseId""#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn update_artist_totals(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "Artist" a SET
             "totalTracks" = sub.track_count,
             "totalFileSize" = sub.total_size,
             "updatedAt" = NOW()
           FROM (
             SELECT lr."artistId",
                    COUNT(lrt.id)::int as track_count,
                    COALESCE(SUM(lrt."fileSize"), 0) as total_size
             FROM "LocalReleaseTrack" lrt
             JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
             GROUP BY lr."artistId"
           ) sub
           WHERE a.id = sub."artistId""#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn update_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    
    // Count everything
    let artist_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*)::bigint FROM "Artist""#)
        .fetch_one(pool)
        .await?;
    
    let track_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*)::bigint FROM "LocalReleaseTrack""#)
        .fetch_one(pool)
        .await?;
    
    let release_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*)::bigint FROM "LocalRelease""#)
        .fetch_one(pool)
        .await?;
    
    let genre_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*)::bigint FROM "Genre""#)
        .fetch_one(pool)
        .await?;
    
    let releases_with_art: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::bigint FROM "LocalRelease" WHERE image IS NOT NULL"#
    )
    .fetch_one(pool)
    .await?;
    
    let total_playtime: (Option<i64>,) = sqlx::query_as(
        r#"SELECT SUM(duration)::bigint FROM "LocalReleaseTrack""#
    )
    .fetch_one(pool)
    .await?;
    
    // Upsert statistics
    sqlx::query(
        r#"INSERT INTO "Statistics" (
             id, artists, tracks, releases, genres, 
             "releasesWithCoverArt", playtime,
             "lastScanEndedAt", "updatedAt"
           )
           VALUES ('main', $1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (id) DO UPDATE SET
             artists = $1,
             tracks = $2,
             releases = $3,
             genres = $4,
             "releasesWithCoverArt" = $5,
             playtime = $6,
             "lastScanEndedAt" = $7,
             "updatedAt" = $7"#,
    )
    .bind(artist_count.0 as i32)
    .bind(track_count.0 as i32)
    .bind(release_count.0 as i32)
    .bind(genre_count.0 as i32)
    .bind(releases_with_art.0 as i32)
    .bind(total_playtime.0.unwrap_or(0))
    .bind(now)
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
    let config = load_config(&args.music_dir);
    let music_dir = config.music_dir.trim_end_matches('/').to_string();

    // Configure thread pool
    if args.threads > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(args.threads)
            .build_global()
            .ok();
    }

    let thread_count = rayon::current_num_threads();

    println!("{}", "DMP Indexer".bright_cyan().bold());
    println!("{}", "===========".bright_black());
    println!("Music dir     : {}", music_dir.bright_white());
    println!("Image storage : {}", config.image_storage.bright_white());
    if !args.only.is_empty() {
        println!("Filter        : only '{}'", args.only.bright_white());
    } else if !args.from.is_empty() || !args.to.is_empty() {
        let from_str = if args.from.is_empty() {
            "A".to_string()
        } else {
            args.from.to_uppercase()
        };
        let to_str = if args.to.is_empty() {
            "Z".to_string()
        } else {
            args.to.to_uppercase()
        };
        println!("Filter        : {} to {}", from_str.bright_white(), to_str.bright_white());
    }
    if args.limit > 0 {
        println!("Limit         : {} files", args.limit.to_string().bright_white());
    }
    if args.resume {
        println!("Mode          : {}", "resume from checkpoint".yellow());
    }
    if args.overwrite {
        println!("Mode          : {}", "overwrite (nuke + re-index)".red());
    }
    if args.skip_images {
        println!("Images        : {}", "skipped".yellow());
    }
    println!("Threads       : {}", thread_count.to_string().bright_white());
    println!();

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    let start = Instant::now();
    let from_filter = args.from.to_lowercase();
    let to_filter = args.to.to_lowercase();
    let only_filter = args.only.to_lowercase();

    // --- Overwrite: nuke matching data first ---
    if args.overwrite {
        println!("{} Nuking matching data...", "[0]".red().bold());
        match nuke_artists(&pool, &from_filter, &to_filter, &only_filter).await {
            Ok(count) => println!("  {} Deleted {} artists and all related data", "✓".green(), count.to_string().bright_white()),
            Err(e) => {
                eprintln!("  {} Error during nuke: {}", "✗".red(), format!("{}", e).red());
                std::process::exit(1);
            }
        }
        clear_checkpoint(&pool).await.ok();
        println!();
    }

    // --- Resume: load checkpoint ---
    let resume_folder = if args.resume {
        match load_checkpoint(&pool).await {
            Ok(Some((folder, count))) => {
                println!("{} Resuming from folder '{}' ({} files already processed)", 
                    "→".yellow(), 
                    folder.bright_white(), 
                    count.to_string().bright_white()
                );
                Some(folder)
            }
            _ => {
                println!("{} No checkpoint found, starting from scratch", "→".yellow());
                None
            }
        }
    } else {
        clear_checkpoint(&pool).await.ok();
        None
    };

    // --- Phase 1: Walk directory tree ---
    println!("{} Walking directory tree...", "[1/4]".bright_blue().bold());
    let extensions = ["mp3", "m4a", "opus", "aac", "ogg", "flac"];
    let total_dirs = AtomicU64::new(0);
    let music_dir_clone = music_dir.clone();
    let last_walk_folder: Mutex<String> = Mutex::new(String::new());

    let from_filter_clone = from_filter.clone();
    let to_filter_clone = to_filter.clone();
    let only_filter_clone = only_filter.clone();
    
    let paths: Vec<PathBuf> = WalkDir::new(&music_dir)
        .follow_links(true)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            // For the root directory, always enter
            if e.depth() == 0 {
                return true;
            }
            
            // For artist folders (depth 1), check if they match the filter
            if e.depth() == 1 && e.file_type().is_dir() {
                let folder = e.file_name().to_string_lossy().to_string();
                let matches = matches_filter(&folder, &from_filter_clone, &to_filter_clone, &only_filter_clone);
                
                // Show progress for matching folders
                if matches {
                    let dir_count = total_dirs.fetch_add(1, Ordering::Relaxed) + 1;
                    if dir_count % 10 == 0 || dir_count == 1 {
                        let mut last = last_walk_folder.lock().unwrap();
                        if *last != folder {
                            eprint!(
                                "\r  {} {} ({} folders)",
                                "→".bright_black(),
                                format!("Scanning: {:<40}", folder).bright_cyan(),
                                dir_count
                            );
                            *last = folder.clone();
                        }
                    }
                }
                
                // Skip this entire directory tree if it doesn't match
                return matches;
            }
            
            // For deeper levels, always enter (we already filtered at artist level)
            true
        })
        .filter_map(|e| e.ok())
        .filter(|e| {
            // Skip directories in the final collection
            if e.file_type().is_dir() {
                return false;
            }

            let folder = get_artist_folder(e.path(), &music_dir_clone);
            
            // Resume: skip folders already processed
            if let Some(ref resume_f) = resume_folder {
                if folder.to_lowercase() <= resume_f.to_lowercase() {
                    return false;
                }
            }

            // Check file extension
            if let Some(ext) = e.path().extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                extensions.contains(&ext_lower.as_str())
            } else {
                false
            }
        })
        .map(|e| e.into_path())
        .take(if args.limit > 0 { args.limit } else { usize::MAX })
        .collect();

    let total_files = paths.len() as u64;
    let total_dirs = total_dirs.load(Ordering::Relaxed);
    eprintln!(); // Clear progress line
    println!(
        "  {} Found {} audio files in {} folders",
        "✓".green(),
        total_files.to_string().bright_white(),
        total_dirs.to_string().bright_white()
    );
    println!();

    if total_files == 0 {
        println!("Nothing to index.");
        return;
    }

    // --- Phase 2: Extract metadata in parallel ---
    println!("{} Scanning metadata...", "[2/4]".bright_blue().bold());
    let scanned = AtomicU64::new(0);
    let errors = AtomicU64::new(0);
    let last_folder: Mutex<String> = Mutex::new(String::new());
    let error_messages: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let error_log = Mutex::new(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("errors.log")
            .expect("Cannot open errors.log"),
    );

    let extracted: Vec<TrackMeta> = paths
        .par_iter()
        .filter_map(|p| {
            let n = scanned.fetch_add(1, Ordering::Relaxed) + 1;

            // Progress
            if n % 100 == 0 || n == 1 {
                let folder = get_artist_folder(p, &music_dir);
                let mut last = last_folder.lock().unwrap();
                if *last != folder || n % 500 == 0 {
                    eprint!(
                        "\r  {} {} {} / {}  ({:.1}%)",
                        "→".bright_black(),
                        format!("Scanning: {:<40}", folder).bright_cyan(),
                        format!("{:>8}", n).white(),
                        total_files,
                        (n as f64 / total_files as f64) * 100.0
                    );
                    *last = folder;
                }
            }

            match extract_metadata(p, &music_dir_clone) {
                Some(meta) => {
                    // Skip if no artist (critical field)
                    if meta.artist.is_none() || meta.artist.as_deref() == Some("") {
                        errors.fetch_add(1, Ordering::Relaxed);
                        let msg = format!("Missing artist tag: {}", p.display());
                        if let Ok(mut f) = error_log.lock() { writeln!(f, "[INDEXER] {}", msg).ok(); }
                        if let Ok(mut v) = error_messages.lock() { v.push(msg); }
                        return None;
                    }
                    Some(meta)
                }
                None => {
                    errors.fetch_add(1, Ordering::Relaxed);
                    let msg = format!("Failed to read: {}", p.display());
                    if let Ok(mut f) = error_log.lock() { writeln!(f, "[INDEXER] {}", msg).ok(); }
                    if let Ok(mut v) = error_messages.lock() { v.push(msg); }
                    None
                }
            }
        })
        .collect();

    eprintln!(); // Clear progress line
    let error_count = errors.load(Ordering::Relaxed);
    if error_count > 0 {
        println!(
            "  {} Extracted {} tracks ({} errors)",
            "✓".green(),
            extracted.len().to_string().bright_white(),
            error_count.to_string().yellow()
        );
    } else {
        println!(
            "  {} Extracted {} tracks",
            "✓".green(),
            extracted.len().to_string().bright_white()
        );
    }
    // Collect Phase 2 error messages for final report
    let mut all_errors: Vec<String> = error_messages.into_inner().unwrap_or_default();
    println!();

    // --- Phase 3: Write to database ---
    println!("{} Writing to database...", "[3/4]".bright_blue().bold());
    let mut new_total = 0u64;
    let mut updated_total = 0u64;
    let mut skipped_total = 0u64;
    let mut db_error_total = 0u64;

    // Track releases that need cover art (first track per release)
    let mut releases_needing_art: HashMap<String, PathBuf> = HashMap::new();

    let total_extracted = extracted.len() as u64;

    // --- Bulk change detection: load ALL existing tracks into memory ---
    eprint!("  {} Loading existing tracks for change detection...", "→".bright_black());
    let existing_rows: Vec<(String, i64, Option<NaiveDateTime>, Option<String>)> = sqlx::query_as(
        r#"SELECT "filePath", "fileSize", mtime, "contentHash" FROM "LocalReleaseTrack""#,
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let existing_tracks: HashMap<String, (i64, NaiveDateTime, String)> = existing_rows
        .into_iter()
        .map(|(path, size, mtime, hash)| {
            (
                path,
                (
                    size,
                    mtime.unwrap_or_else(|| Utc::now().naive_utc()),
                    hash.unwrap_or_default(),
                ),
            )
        })
        .collect();
    eprintln!(" {} ({} existing tracks loaded)", "✓".green(), existing_tracks.len());

    // --- In-memory caches for artist/release lookups ---
    let mut artist_cache: HashMap<String, String> = HashMap::new();
    let mut release_cache: HashMap<(String, String), String> = HashMap::new();

    // --- Group tracks by artist folder for transaction batching ---
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    {
        let mut group_map: HashMap<String, Vec<usize>> = HashMap::new();
        let mut group_order: Vec<String> = Vec::new();
        for (i, track) in extracted.iter().enumerate() {
            let folder = track.file_path.split('/').next().unwrap_or("").to_string();
            if !group_map.contains_key(&folder) {
                group_order.push(folder.clone());
            }
            group_map.entry(folder).or_default().push(i);
        }
        for folder in group_order {
            if let Some(indices) = group_map.remove(&folder) {
                groups.push((folder, indices));
            }
        }
    }

    let mut processed = 0u64;
    let total_groups = groups.len();

    for (group_idx, (folder, indices)) in groups.iter().enumerate() {
        // Progress
        eprint!(
            "\r  {} {} {} / {}  ({:.1}%) [{}/{}]",
            "→".bright_black(),
            format!("Writing: {:<40}", folder).bright_cyan(),
            format!("{:>8}", processed).white(),
            total_extracted,
            (processed as f64 / total_extracted as f64) * 100.0,
            group_idx + 1,
            total_groups
        );

        // Begin transaction for this artist folder group
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                db_error_total += indices.len() as u64;
                if let Ok(mut f) = error_log.lock() {
                    writeln!(f, "[INDEXER] Failed to begin transaction for folder '{}': {}", folder, e).ok();
                }
                processed += indices.len() as u64;
                continue;
            }
        };

        let mut group_errors = 0u64;

        for &idx in indices {
            let track = &extracted[idx];
            processed += 1;

            // Change detection using in-memory HashMap (replaces per-track DB query)
            if let Some((existing_size, existing_mtime, existing_hash)) = existing_tracks.get(&track.file_path) {
                if *existing_size == track.file_size
                    && (*existing_mtime - track.mtime).num_seconds().abs() < 2
                {
                    // mtime + size match -> skip
                    skipped_total += 1;
                    continue;
                }
                // Size or mtime changed -> check content hash
                if *existing_hash == track.content_hash {
                    // Content unchanged, just update mtime
                    let now = Utc::now().naive_utc();
                    sqlx::query(
                        r#"UPDATE "LocalReleaseTrack" SET mtime = $1, "updatedAt" = $2 WHERE "filePath" = $3"#,
                    )
                    .bind(track.mtime)
                    .bind(now)
                    .bind(&track.file_path)
                    .execute(&mut *tx)
                    .await
                    .ok();
                    skipped_total += 1;
                    continue;
                }
                // Content changed -> full update
                updated_total += 1;
            } else {
                // New file
                new_total += 1;
            }

            // Split artist tags into individual artists
            let album_artist_tag = track.album_artist.as_deref().unwrap_or("");
            let track_artist_tag = track.artist.as_deref().unwrap_or("");

            let (main_album_artists, feat_album_artists) = if !album_artist_tag.is_empty() && !is_various_artists(album_artist_tag) {
                split_artists(album_artist_tag)
            } else {
                (Vec::new(), Vec::new())
            };

            let (main_track_artists, feat_track_artists) = if !track_artist_tag.is_empty() {
                split_artists(track_artist_tag)
            } else {
                (Vec::new(), Vec::new())
            };

            // Canonical artist: first main album artist, or first main track artist
            let canonical_name = main_album_artists.first()
                .or(main_track_artists.first())
                .map(|s| s.as_str())
                .unwrap_or("Unknown Artist");
            let album_name = track.album.as_deref().unwrap_or("Unknown Album");

            // Ensure canonical artist exists (cached)
            let artist_id = match ensure_artist_cached(&pool, canonical_name, &mut artist_cache).await {
                Ok(id) if !id.is_empty() => id,
                Ok(_) => {
                    group_errors += 1;
                    continue;
                }
                Err(e) => {
                    group_errors += 1;
                    let msg = format!("DB error (artist '{}') {}: {}", canonical_name, track.file_path, e);
                    if let Ok(mut f) = error_log.lock() { writeln!(f, "[INDEXER] {}", msg).ok(); }
                    all_errors.push(msg);
                    continue;
                }
            };

            // Ensure local release exists (cached)
            let folder_path = {
                let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                if parts.len() > 1 { Some(parts[1].to_string()) } else { None }
            };
            let release_id = match ensure_local_release_cached(
                &pool,
                &artist_id,
                album_name,
                track.year,
                folder_path.as_deref(),
                &mut release_cache,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    group_errors += 1;
                    let msg = format!("DB error (release '{}') {}: {}", album_name, track.file_path, e);
                    if let Ok(mut f) = error_log.lock() { writeln!(f, "[INDEXER] {}", msg).ok(); }
                    all_errors.push(msg);
                    continue;
                }
            };

            // Upsert track (on transaction)
            let track_id = match upsert_track(&pool, track, &release_id).await {
                Ok(id) => id,
                Err(e) => {
                    group_errors += 1;
                    let msg = format!("DB error (track) {}: {}", track.file_path, e);
                    if let Ok(mut f) = error_log.lock() { writeln!(f, "[INDEXER] {}", msg).ok(); }
                    all_errors.push(msg);
                    continue;
                }
            };

            // TrackArtist: ALBUM_ARTIST role for all main album artists
            for aa_name in &main_album_artists {
                if let Ok(aa_id) = ensure_artist_cached(&pool, aa_name, &mut artist_cache).await {
                    if !aa_id.is_empty() {
                        ensure_track_artist(&pool, &track_id, &aa_id, "ALBUM_ARTIST").await.ok();
                    }
                }
            }
            // If no album artists were split, at least tag the canonical artist
            if main_album_artists.is_empty() {
                ensure_track_artist(&pool, &track_id, &artist_id, "ALBUM_ARTIST").await.ok();
            }

            // TrackArtist: PRIMARY role for all main track artists
            if main_track_artists.is_empty() {
                // No track artist tag — use canonical artist as PRIMARY
                ensure_track_artist(&pool, &track_id, &artist_id, "PRIMARY").await.ok();
            } else {
                for ta_name in &main_track_artists {
                    if let Ok(ta_id) = ensure_artist_cached(&pool, ta_name, &mut artist_cache).await {
                        if !ta_id.is_empty() {
                            ensure_track_artist(&pool, &track_id, &ta_id, "PRIMARY").await.ok();
                        }
                    }
                }
            }

            // TrackArtist: FEATURED role for all featured artists (from both tags)
            let all_featured: Vec<String> = feat_album_artists.iter()
                .chain(feat_track_artists.iter())
                .cloned()
                .collect::<std::collections::HashSet<String>>()
                .into_iter()
                .collect();
            for feat_name in &all_featured {
                if let Ok(feat_id) = ensure_artist_cached(&pool, feat_name, &mut artist_cache).await {
                    if !feat_id.is_empty() {
                        ensure_track_artist(&pool, &track_id, &feat_id, "FEATURED").await.ok();
                    }
                }
            }

            // Track cover art candidates (first track per release with a picture)
            if track.has_picture && !args.skip_images {
                let img_dir = PathBuf::from(&config.project_root)
                    .join("web/public/img/releases");
                let out_path = img_dir.join(format!("{}.jpg", release_id));

                if !out_path.exists() {
                    releases_needing_art
                        .entry(release_id.clone())
                        .or_insert_with(|| PathBuf::from(&track.file_path));
                }
            }
        }

        db_error_total += group_errors;

        // Commit transaction for this folder group
        if let Err(e) = tx.commit().await {
            if let Ok(mut f) = error_log.lock() {
                writeln!(f, "[INDEXER] Failed to commit transaction for folder '{}': {}", folder, e).ok();
            }
        }

        // Save checkpoint every 10 folders
        if (group_idx + 1) % 10 == 0 {
            save_checkpoint(
                &pool,
                folder,
                processed as i32,
                &music_dir,
                &from_filter,
                &to_filter,
                &only_filter,
            )
            .await
            .ok();
        }
    }

    eprintln!(); // Clear progress line
    println!(
        "  {} New: {} | Updated: {} | Skipped: {} | Errors: {}",
        "✓".green(),
        new_total.to_string().bright_green(),
        updated_total.to_string().bright_yellow(),
        skipped_total.to_string().bright_black(),
        if db_error_total > 0 { db_error_total.to_string().red() } else { db_error_total.to_string().bright_black() }
    );
    let total_errors = errors.load(Ordering::Relaxed) + db_error_total;
    if !all_errors.is_empty() {
        println!();
        for msg in &all_errors {
            println!("  {} {}", "✗".red(), msg.bright_red());
        }
        if total_errors as usize > all_errors.len() {
            println!("  {} {} more errors in errors.log", "↳".bright_black(), total_errors as usize - all_errors.len());
        }
    }
    println!();

    // --- Cover art extraction ---
    if !args.skip_images {
        let art_map = &releases_needing_art;
        if !art_map.is_empty() {
            println!("{} Extracting cover art...", "[3b]".bright_blue().bold());
            println!("  {} Processing {} releases (parallel)", "→".bright_black(), art_map.len());

            // Initialize S3 client if needed
            let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
            let use_local = config.image_storage == "local" || config.image_storage == "both";
            let s3_client = if use_s3 {
                create_s3_client(&config).await
            } else {
                None
            };

            let img_dir = PathBuf::from(&config.project_root)
                .join("web/public/img/releases");

            // Phase 1: Parallel CPU-bound extract+resize using rayon
            let art_entries: Vec<(&String, &PathBuf)> = art_map.iter().collect();
            let extracted_covers: Vec<(String, PathBuf, bool)> = art_entries
                .par_iter()
                .map(|(release_id, source_path)| {
                    let out_path = img_dir.join(format!("{}.jpg", release_id));
                    if out_path.exists() {
                        return ((*release_id).clone(), out_path, false); // already exists
                    }
                    let success = extract_cover_art(source_path, &out_path);
                    ((*release_id).clone(), out_path, success)
                })
                .collect();

            // Phase 2: Sequential S3 uploads + DB updates
            let mut saved = 0u32;
            let mut existing = 0u32;
            for (release_id, out_path, newly_extracted) in &extracted_covers {
                if !newly_extracted {
                    if out_path.exists() {
                        existing += 1;
                    }
                    continue;
                }

                // S3 upload
                if use_s3 {
                    if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                        (&s3_client, &config.s3_bucket, &config.s3_public_url)
                    {
                        let s3_key = format!("releases/{}.jpg", release_id);
                        match upload_to_s3(client, bucket, &s3_key, out_path).await {
                            Ok(_) => {
                                let image_url = format!(
                                    "{}/{}",
                                    public_url.trim_end_matches('/'),
                                    s3_key
                                );
                                sqlx::query(
                                    r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&image_url)
                                .bind(release_id)
                                .execute(&pool)
                                .await
                                .ok();
                            }
                            Err(e) => {
                                eprintln!("Failed to upload {} to S3: {:?}", release_id, e);
                                if let Ok(mut f) = error_log.lock() {
                                    writeln!(
                                        f,
                                        "[INDEXER] S3 upload failed for release {}: {:?}",
                                        release_id, e
                                    )
                                    .ok();
                                }
                            }
                        }
                    }
                }

                // Local storage
                if use_local {
                    let relative = format!("/img/releases/{}.jpg", release_id);
                    sqlx::query(
                        r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&relative)
                    .bind(release_id)
                    .execute(&pool)
                    .await
                    .ok();
                }

                // Delete local file if only using S3
                if !use_local && use_s3 && out_path.exists() {
                    fs::remove_file(out_path).ok();
                }

                saved += 1;
            }
            println!(
                "  {} Saved {} covers, {} already exist",
                "✓".green(),
                saved.to_string().bright_white(),
                existing.to_string().bright_black()
            );
            println!();
        }
        
        let missing_releases: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT DISTINCT ON (lr.id) lr.id, lrt."filePath"
               FROM "LocalRelease" lr
               JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
               WHERE (lr.image IS NULL OR lr.image = '')
                 AND (lr."imageUrl" IS NULL OR lr."imageUrl" = '')
               ORDER BY lr.id, lrt."trackNumber" NULLS LAST, lrt."filePath""#
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        
        if !missing_releases.is_empty() {
            println!("  {} Found {} releases with missing images", "→".bright_black(), missing_releases.len());
            
            let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
            let use_local = config.image_storage == "local" || config.image_storage == "both";
            let s3_client = if use_s3 {
                create_s3_client(&config).await
            } else {
                None
            };
            
            let img_dir = PathBuf::from(&config.project_root)
                .join("web/public/img/releases");
            
            let mut extracted = 0u32;
            let mut failed = 0u32;
            
            for (release_id, file_path) in missing_releases {
                let full_path = PathBuf::from(&music_dir).join(&file_path);
                let out_path = img_dir.join(format!("{}.jpg", release_id));
                
                if extract_cover_art(&full_path, &out_path) {
                    // S3 upload
                    if use_s3 {
                        if let (Some(ref client), Some(ref bucket), Some(ref public_url)) = 
                            (&s3_client, &config.s3_bucket, &config.s3_public_url) {
                            let s3_key = format!("releases/{}.jpg", release_id);
                            match upload_to_s3(client, bucket, &s3_key, &out_path).await {
                                Ok(_) => {
                                    let image_url = format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
                                    sqlx::query(
                                        r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                    )
                                    .bind(&image_url)
                                    .bind(&release_id)
                                    .execute(&pool)
                                    .await
                                    .ok();
                                }
                                Err(e) => {
                                    eprintln!("  Failed to upload {} to S3: {:?}", release_id, e);
                                }
                            }
                        }
                    }
                    
                    // Local storage
                    if use_local {
                        let relative = format!("/img/releases/{}.jpg", release_id);
                        sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&relative)
                        .bind(&release_id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                    
                    // Delete local file if only using S3
                    if !use_local && use_s3 && out_path.exists() {
                        fs::remove_file(&out_path).ok();
                    }
                    
                    extracted += 1;
                } else {
                    failed += 1;
                }
            }
            
            println!(
                "  {} Extracted {} missing covers, {} failed",
                "✓".green(),
                extracted.to_string().bright_white(),
                if failed > 0 { failed.to_string().yellow() } else { failed.to_string().bright_black() }
            );
            println!();
        } else {
            println!("  {} All releases have images", "✓".green());
            println!();
        }
    }

    // --- Phase 4: Post-processing ---
    println!("{} Post-processing...", "[4/4]".bright_blue().bold());
    let releases_updated = update_release_totals(&pool).await.unwrap_or(0);
    let artists_updated = update_artist_totals(&pool).await.unwrap_or(0);
    println!(
        "  {} Updated {} releases, {} artists",
        "✓".green(),
        releases_updated.to_string().bright_white(),
        artists_updated.to_string().bright_white()
    );

    // Update statistics
    match update_statistics(&pool).await {
        Ok(_) => println!("  {} Updated statistics", "✓".green()),
        Err(e) => eprintln!("  {} Failed to update statistics: {}", "✗".red(), e),
    }

    // Clear checkpoint on success
    clear_checkpoint(&pool).await.ok();
    println!("  {} Checkpoint cleared", "✓".green());

    let elapsed = start.elapsed();
    println!();
    println!("{}", "═".repeat(60).bright_black());
    println!();
    println!("{} {:.1}s", "Completed in:".white().bold(), elapsed.as_secs_f64());
    println!("  {} {}", "New tracks:".green(), new_total);
    println!("  {} {}", "Updated:".yellow(), updated_total);
    println!("  {} {}", "Skipped:".bright_black(), skipped_total);
    if total_errors > 0 {
        println!("  {} {}", "Errors:".red(), total_errors);
    }
}
