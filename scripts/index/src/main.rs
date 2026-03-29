use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client as S3Client;
use chrono::{NaiveDateTime, Utc};
use clap::Parser;
use colored::*;
use lofty::config::{ParseOptions, ParsingMode};
use lofty::prelude::*;
use lofty::probe::Probe;
use md5::{Digest, Md5};
use rayon::prelude::*;
use regex::Regex;
use serde_json::Value as JsonValue;
use slug::slugify;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::fs;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
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

fn extract_metadata(path: &Path, music_dir: &str) -> Result<TrackMeta, String> {
    let meta = fs::metadata(path).map_err(|e| format!("cannot stat file: {e}"))?;
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

    let parse_opts = ParseOptions::new().read_properties(true).parsing_mode(ParsingMode::Relaxed);
    let tagged_file = Probe::open(path)
        .map_err(|e| format!("cannot open file: {e}"))?
        .options(parse_opts)
        .read()
        .map_err(|e| format!("cannot read tags: {e}"))?;

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

    Ok(TrackMeta {
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
/// - Then splits each side by "/" "//" "\" "\\" "|" "||" ";"
/// - Does NOT split on "," (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
/// - Does NOT split on "&" (too ambiguous: "Simon & Garfunkel")
/// - Trims whitespace, filters empties, deduplicates, skips "Various Artists" variants
fn split_artists(tag: &str) -> (Vec<String>, Vec<String>) {
    static FEAT_RE: OnceLock<Regex> = OnceLock::new();
    let feat_re = FEAT_RE.get_or_init(|| Regex::new(r"(?i)\s*\(\s*feat(?:uring)?\.?\s+|\s+feat(?:uring)?\.?\s+|\s*\(\s*ft\.?\s+|\s+ft\.?\s+").unwrap());

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

    // Delimiters (checked longest-first so // \\ || beat their single-char forms):
    //   // \\ || / \ | ;   — always split
    //   ,                  — NOT split (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
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
    let parse_opts = ParseOptions::new().read_properties(false).parsing_mode(ParsingMode::Relaxed);
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
                        image::imageops::FilterType::Triangle,
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

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    // Single query: INSERT or no-op UPDATE (to enable RETURNING on conflict)
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "Artist" (id, name, slug, "totalPlayCount", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 0, 0, 0, $4, $4)
           ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&artist_slug)
    .bind(now)
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
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    // Single query: INSERT or UPDATE year on conflict, always RETURNING id
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "LocalRelease" (id, title, year, "artistId", "matchStatus", "forcedComplete", "totalPlayCount", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath")
           VALUES ($1, $2, $3, $4, 'UNKNOWN', false, 0, 0, 0, $5, $5, $6)
           ON CONFLICT ("artistId", title) DO UPDATE SET year = COALESCE(EXCLUDED.year, "LocalRelease".year), "updatedAt" = $5
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(year)
    .bind(artist_id)
    .bind(now)
    .bind(folder_path)
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

/// Batch upsert tracks using UNNEST arrays — single round-trip for an entire folder.
/// Returns a map of filePath → track_id for linking TrackArtist rows.
async fn batch_upsert_tracks(
    pool: &PgPool,
    tracks: &[(&TrackMeta, String)], // (track, release_id)
) -> Result<HashMap<String, String>, sqlx::Error> {
    if tracks.is_empty() {
        return Ok(HashMap::new());
    }

    let len = tracks.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut titles: Vec<Option<String>> = Vec::with_capacity(len);
    let mut artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut album_artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut albums: Vec<Option<String>> = Vec::with_capacity(len);
    let mut years: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut genres: Vec<Option<String>> = Vec::with_capacity(len);
    let mut durations: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut bitrates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut sample_rates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut file_paths: Vec<String> = Vec::with_capacity(len);
    let mut positions: Vec<Option<String>> = Vec::with_capacity(len);
    let mut track_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut disc_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut release_ids: Vec<String> = Vec::with_capacity(len);
    let mut file_sizes: Vec<i64> = Vec::with_capacity(len);
    let mut mtimes: Vec<NaiveDateTime> = Vec::with_capacity(len);
    let mut content_hashes: Vec<String> = Vec::with_capacity(len);
    let mut metadatas: Vec<serde_json::Value> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();

    for (track, release_id) in tracks {
        ids.push(cuid2::create_id());
        titles.push(track.title.clone());
        artists.push(track.artist.clone());
        album_artists.push(track.album_artist.clone());
        albums.push(track.album.clone());
        years.push(track.year);
        genres.push(track.genre.clone());
        durations.push(track.duration);
        bitrates.push(track.bitrate);
        sample_rates.push(track.sample_rate);
        file_paths.push(track.file_path.clone());
        positions.push(track.position.clone());
        track_numbers.push(track.track_number);
        disc_numbers.push(track.disc_number);
        release_ids.push(release_id.clone());
        file_sizes.push(track.file_size);
        mtimes.push(track.mtime);
        content_hashes.push(track.content_hash.clone());
        metadatas.push(serde_json::to_value(&track.metadata_json).unwrap_or(JsonValue::Null));
    }

    let play_counts: Vec<i32> = vec![0; len];
    let created: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "playCount", "createdAt", "updatedAt")
           SELECT * FROM UNNEST(
               $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
               $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::int[], $14::int[],
               $15::text[], $16::bigint[], $17::timestamp[], $18::text[], $19::jsonb[],
               $20::int[], $21::timestamp[], $22::timestamp[]
           )
           ON CONFLICT ("filePath") DO UPDATE SET
             title = EXCLUDED.title, artist = EXCLUDED.artist, "albumArtist" = EXCLUDED."albumArtist",
             album = EXCLUDED.album, year = EXCLUDED.year, genre = EXCLUDED.genre,
             duration = EXCLUDED.duration, bitrate = EXCLUDED.bitrate, "sampleRate" = EXCLUDED."sampleRate",
             position = EXCLUDED.position, "trackNumber" = EXCLUDED."trackNumber", "discNumber" = EXCLUDED."discNumber",
             "localReleaseId" = EXCLUDED."localReleaseId", "fileSize" = EXCLUDED."fileSize",
             mtime = EXCLUDED.mtime, "contentHash" = EXCLUDED."contentHash", metadata = EXCLUDED.metadata,
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id, "filePath""#,
    )
    .bind(&ids)
    .bind(&titles)
    .bind(&artists)
    .bind(&album_artists)
    .bind(&albums)
    .bind(&years)
    .bind(&genres)
    .bind(&durations)
    .bind(&bitrates)
    .bind(&sample_rates)
    .bind(&file_paths)
    .bind(&positions)
    .bind(&track_numbers)
    .bind(&disc_numbers)
    .bind(&release_ids)
    .bind(&file_sizes)
    .bind(&mtimes)
    .bind(&content_hashes)
    .bind(&metadatas)
    .bind(&play_counts)
    .bind(&created)
    .bind(&created)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, path)| (path, id)).collect())
}

/// Batch insert TrackArtist rows using UNNEST — single round-trip.
async fn batch_ensure_track_artists(
    pool: &PgPool,
    links: &[(String, String, String)], // (track_id, artist_id, role)
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }

    let len = links.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut track_ids: Vec<String> = Vec::with_capacity(len);
    let mut artist_ids: Vec<String> = Vec::with_capacity(len);
    let mut roles: Vec<String> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();
    let mut timestamps: Vec<NaiveDateTime> = Vec::with_capacity(len);

    for (tid, aid, role) in links {
        ids.push(cuid2::create_id());
        track_ids.push(tid.clone());
        artist_ids.push(aid.clone());
        roles.push(role.clone());
        timestamps.push(now);
    }

    sqlx::query(
        r#"INSERT INTO "TrackArtist" (id, "trackId", "artistId", role, "createdAt")
           SELECT id, "trackId", "artistId", role::"TrackArtistRole", "createdAt"
           FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamp[])
             AS t(id, "trackId", "artistId", role, "createdAt")
           ON CONFLICT ("trackId", "artistId", role) DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&track_ids)
    .bind(&artist_ids)
    .bind(&roles)
    .bind(&timestamps)
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

async fn save_index_progress(pool: &PgPool, artist_folder: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastIndexedArtist" = $1, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .bind(artist_folder)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_index_progress(pool: &PgPool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT "lastIndexedArtist" FROM "Statistics" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(v,)| v))
}

async fn clear_index_progress(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastIndexedArtist" = NULL, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Post-processing: update release and artist totals
// ---------------------------------------------------------------------------

async fn update_release_totals_for_artist(pool: &PgPool, artist_id: &str) -> Result<u64, sqlx::Error> {
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
           WHERE lr.id = sub."localReleaseId"
             AND lr."artistId" = $1"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn update_artist_totals_for_artist(pool: &PgPool, artist_id: &str) -> Result<u64, sqlx::Error> {
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
             WHERE lr."artistId" = $1
             GROUP BY lr."artistId"
           ) sub
           WHERE a.id = sub."artistId""#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn update_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();

    // Single query: compute all counts and upsert in one round-trip
    sqlx::query(
        r#"INSERT INTO "Statistics" (
             id, artists, tracks, releases, genres,
             "releasesWithCoverArt", playtime,
             "lastScanEndedAt", "updatedAt"
           )
           SELECT 'main',
             (SELECT COUNT(*)::int FROM "Artist"),
             (SELECT COUNT(*)::int FROM "LocalReleaseTrack"),
             (SELECT COUNT(*)::int FROM "LocalRelease"),
             (SELECT COUNT(*)::int FROM "Genre"),
             (SELECT COUNT(*)::int FROM "LocalRelease" WHERE image IS NOT NULL),
             COALESCE((SELECT SUM(duration)::bigint FROM "LocalReleaseTrack"), 0),
             $1, $1
           ON CONFLICT (id) DO UPDATE SET
             artists = EXCLUDED.artists,
             tracks = EXCLUDED.tracks,
             releases = EXCLUDED.releases,
             genres = EXCLUDED.genres,
             "releasesWithCoverArt" = EXCLUDED."releasesWithCoverArt",
             playtime = EXCLUDED.playtime,
             "lastScanEndedAt" = EXCLUDED."lastScanEndedAt",
             "updatedAt" = EXCLUDED."updatedAt""#,
    )
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

    // Ensure Statistics row exists
    sqlx::query(
        r#"INSERT INTO "Statistics" (id, "updatedAt") VALUES ('main', NOW()) ON CONFLICT DO NOTHING"#,
    )
    .execute(&pool)
    .await
    .ok();

    // --- Overwrite: nuke matching data first ---
    if args.overwrite {
        println!("{} Nuking matching data...", "💥");
        match nuke_artists(&pool, &from_filter, &to_filter, &only_filter).await {
            Ok(count) => println!("   Deleted {} artists and all related data", count.to_string().bright_white()),
            Err(e) => {
                eprintln!("  {} Error during nuke: {}", "❌", format!("{}", e));
                std::process::exit(1);
            }
        }
        clear_index_progress(&pool).await.ok();
        println!();
    }

    // --- Resume: load progress ---
    let resume_folder = if args.resume {
        match load_index_progress(&pool).await {
            Ok(Some(folder)) => {
                println!("{} Resuming after '{}'", "🔄", folder.bright_white());
                Some(folder)
            }
            _ => {
                println!("{} No progress found, starting from scratch", "🔄");
                None
            }
        }
    } else {
        clear_index_progress(&pool).await.ok();
        None
    };

    // --- Setup: Load caches and existing tracks ---
    println!("{} Loading existing tracks for change detection...", "⌛");

    let error_log = Mutex::new(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("errors.log")
            .expect("Cannot open errors.log"),
    );

    // Load existing tracks for change detection
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
    eprintln!("   Loaded {} existing tracks", existing_tracks.len().to_string().bright_white());

    // Pre-load artist and release caches
    let mut artist_cache: HashMap<String, String> = HashMap::new();
    {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT slug, id FROM "Artist""#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        for (slug, id) in rows {
            artist_cache.insert(slug, id);
        }
        eprintln!("   Cached {} artists", artist_cache.len().to_string().bright_white());
    }

    let mut release_cache: HashMap<(String, String), String> = HashMap::new();
    {
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            r#"SELECT "artistId", title, id FROM "LocalRelease""#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        for (artist_id, title, id) in rows {
            release_cache.insert((artist_id, title), id);
        }
        eprintln!("   Cached {} releases", release_cache.len().to_string().bright_white());
    }
    println!();

    // --- List artist folders (instant — just reads depth-1 directory entries) ---
    println!("{} Indexing per artist...", "📝");
    let extensions: &[&str] = &["mp3", "m4a", "opus", "aac", "ogg", "flac"];

    let mut artist_folders: Vec<String> = fs::read_dir(&music_dir)
        .expect("Cannot read music directory")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map_or(false, |ft| ft.is_dir() || ft.is_symlink()))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|f| matches_filter(f, &from_filter, &to_filter, &only_filter))
        .collect();
    artist_folders.sort_unstable();

    // Resume: skip folders already processed
    if let Some(ref resume_f) = resume_folder {
        let resume_lower = resume_f.to_lowercase();
        artist_folders.retain(|f| f.to_lowercase() > resume_lower);
    }

    let total_folders = artist_folders.len();
    if total_folders == 0 {
        println!("  No matching folders found. Nothing to index.");
        return;
    }

    let mut new_total = 0u64;
    let mut updated_total = 0u64;
    let mut skipped_total = 0u64;
    let mut db_error_total = 0u64;
    let mut scan_error_total = 0u64;
    let mut total_files = 0u64;
    let mut artists_with_errors: Vec<(String, u64)> = Vec::new();
    let mut files_limit_remaining: usize = if args.limit > 0 { args.limit } else { usize::MAX };
    let music_dir_clone = music_dir.clone();

    // Pre-init S3 client and image config (used per-artist for cover art)
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let use_local = config.image_storage == "local" || config.image_storage == "both";
    let s3_client = if use_s3 && !args.skip_images {
        create_s3_client(&config).await
    } else {
        None
    };
    let img_dir = PathBuf::from(&config.project_root).join("web/public/img/releases");

    // Helper closure: print artist header + sub-status on two lines, overwriting both
    let print_status = |folder_name: &str, folder_idx: usize, total: usize, step: &str| {
        // Move to start of line, clear two lines, print both
        eprint!(
            "\r\x1b[K   {} ({} of {})\n\x1b[K   {}\x1b[A",
            folder_name,
            folder_idx + 1,
            total,
            step.bright_black(),
        );
    };

    for (folder_idx, folder_name) in artist_folders.iter().enumerate() {
        if files_limit_remaining == 0 {
            break;
        }

        print_status(folder_name, folder_idx, total_folders, "scanning files...");

        // --- Step 1: Walk files in this folder ---
        let folder_path = PathBuf::from(&music_dir).join(folder_name);
        let paths: Vec<PathBuf> = WalkDir::new(&folder_path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                if e.file_type().is_dir() { return false; }
                e.path().extension()
                    .map_or(false, |ext| {
                        let ext_lower = ext.to_string_lossy().to_lowercase();
                        extensions.contains(&ext_lower.as_str())
                    })
            })
            .map(|e| e.into_path())
            .take(files_limit_remaining)
            .collect();

        let folder_file_count = paths.len();
        if folder_file_count == 0 {
            save_index_progress(&pool, folder_name).await.ok();
            continue;
        }
        files_limit_remaining = files_limit_remaining.saturating_sub(folder_file_count);
        total_files += folder_file_count as u64;

        // --- Step 2: Extract metadata in parallel (rayon) ---
        print_status(folder_name, folder_idx, total_folders, &format!("extracting metadata ({} files)...", folder_file_count));
        let scan_errors = AtomicU64::new(0);

        let extracted: Vec<TrackMeta> = paths
            .par_iter()
            .filter_map(|p| {
                match extract_metadata(p, &music_dir_clone) {
                    Ok(meta) => {
                        if meta.artist.is_none() || meta.artist.as_deref() == Some("") {
                            scan_errors.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut f) = error_log.lock() {
                                writeln!(f, "[{}][INDEX] Missing artist tag: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), p.display()).ok();
                            }
                            return None;
                        }
                        Some(meta)
                    }
                    Err(reason) => {
                        scan_errors.fetch_add(1, Ordering::Relaxed);
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[{}][INDEX] Failed to read: {} ({})", Utc::now().format("%Y-%m-%d %H:%M:%S"), p.display(), reason).ok();
                        }
                        None
                    }
                }
            })
            .collect();

        let folder_scan_errors = scan_errors.load(Ordering::Relaxed);
        scan_error_total += folder_scan_errors;

        if folder_scan_errors > 0 {
            artists_with_errors.push((folder_name.clone(), folder_scan_errors));
        }

        if extracted.is_empty() {
            save_index_progress(&pool, folder_name).await.ok();
            continue;
        }

        // --- Step 3: Change detection + batch upsert ---
        print_status(folder_name, folder_idx, total_folders, "upserting to database...");
        let mut group_errors = 0u64;
        let mut batch_tracks: Vec<(&TrackMeta, String)> = Vec::new();
        let mut pending_links: Vec<(String, String, String)> = Vec::new();
        let mut mtime_updates: Vec<(NaiveDateTime, String)> = Vec::new();
        let mut folder_artist_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut releases_needing_art: HashMap<String, PathBuf> = HashMap::new();

        for track in &extracted {
            // Change detection
            if let Some((existing_size, existing_mtime, existing_hash)) = existing_tracks.get(&track.file_path) {
                if *existing_size == track.file_size
                    && (*existing_mtime - track.mtime).num_seconds().abs() < 2
                {
                    skipped_total += 1;
                    continue;
                }
                if *existing_hash == track.content_hash {
                    mtime_updates.push((track.mtime, track.file_path.clone()));
                    skipped_total += 1;
                    continue;
                }
                updated_total += 1;
            } else {
                new_total += 1;
            }

            // Split artist tags
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

            let canonical_name = main_album_artists.first()
                .or(main_track_artists.first())
                .map(|s| s.as_str())
                .unwrap_or("Unknown Artist");
            let album_name = track.album.as_deref().unwrap_or("Unknown Album");

            let artist_id = match ensure_artist_cached(&pool, canonical_name, &mut artist_cache).await {
                Ok(id) if !id.is_empty() => id,
                Ok(_) => { group_errors += 1; continue; }
                Err(e) => {
                    group_errors += 1;
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][INDEX] DB error (artist '{}') {}: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), canonical_name, track.file_path, e).ok();
                    }
                    continue;
                }
            };

            folder_artist_ids.insert(artist_id.clone());

            let folder_path = {
                let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                if parts.len() > 1 { Some(parts[1].to_string()) } else { None }
            };
            let release_id = match ensure_local_release_cached(
                &pool, &artist_id, album_name, track.year,
                folder_path.as_deref(), &mut release_cache,
            ).await {
                Ok(id) => id,
                Err(e) => {
                    group_errors += 1;
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][INDEX] DB error (release '{}') {}: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), album_name, track.file_path, e).ok();
                    }
                    continue;
                }
            };

            let fp = track.file_path.clone();

            // ALBUM_ARTIST role
            if main_album_artists.is_empty() {
                pending_links.push((fp.clone(), artist_id.clone(), "ALBUM_ARTIST".to_string()));
            } else {
                for aa_name in &main_album_artists {
                    if let Ok(aa_id) = ensure_artist_cached(&pool, aa_name, &mut artist_cache).await {
                        if !aa_id.is_empty() {
                            pending_links.push((fp.clone(), aa_id, "ALBUM_ARTIST".to_string()));
                        }
                    }
                }
            }

            // PRIMARY role
            if main_track_artists.is_empty() {
                pending_links.push((fp.clone(), artist_id.clone(), "PRIMARY".to_string()));
            } else {
                for ta_name in &main_track_artists {
                    if let Ok(ta_id) = ensure_artist_cached(&pool, ta_name, &mut artist_cache).await {
                        if !ta_id.is_empty() {
                            pending_links.push((fp.clone(), ta_id, "PRIMARY".to_string()));
                        }
                    }
                }
            }

            // FEATURED role
            let all_featured: Vec<String> = feat_album_artists.iter()
                .chain(feat_track_artists.iter())
                .cloned()
                .collect::<std::collections::HashSet<String>>()
                .into_iter()
                .collect();
            for feat_name in &all_featured {
                if let Ok(feat_id) = ensure_artist_cached(&pool, feat_name, &mut artist_cache).await {
                    if !feat_id.is_empty() {
                        pending_links.push((fp.clone(), feat_id, "FEATURED".to_string()));
                    }
                }
            }

            // Cover art candidates
            if track.has_picture && !args.skip_images {
                let out_path = img_dir.join(format!("{}.jpg", release_id));
                if !out_path.exists() {
                    releases_needing_art
                        .entry(release_id.clone())
                        .or_insert_with(|| PathBuf::from(&track.file_path));
                }
            }

            batch_tracks.push((track, release_id));
        }

        db_error_total += group_errors;

        // Batch mtime updates
        if !mtime_updates.is_empty() {
            let mtimes_v: Vec<NaiveDateTime> = mtime_updates.iter().map(|(m, _)| *m).collect();
            let paths_v: Vec<String> = mtime_updates.into_iter().map(|(_, p)| p).collect();
            let now = Utc::now().naive_utc();
            sqlx::query(
                r#"UPDATE "LocalReleaseTrack" SET mtime = u.mtime, "updatedAt" = $3
                   FROM UNNEST($1::timestamp[], $2::text[]) AS u(mtime, path)
                   WHERE "LocalReleaseTrack"."filePath" = u.path"#,
            )
            .bind(&mtimes_v)
            .bind(&paths_v)
            .bind(now)
            .execute(&pool)
            .await
            .ok();
        }

        // Batch track upsert + track_artist insert
        if !batch_tracks.is_empty() {
            match batch_upsert_tracks(&pool, &batch_tracks).await {
                Ok(path_to_id) => {
                    let resolved_links: Vec<(String, String, String)> = pending_links
                        .into_iter()
                        .filter_map(|(fp, aid, role)| {
                            path_to_id.get(&fp).map(|tid| (tid.clone(), aid, role))
                        })
                        .collect();

                    if let Err(e) = batch_ensure_track_artists(&pool, &resolved_links).await {
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[{}][INDEX] DB error (batch track_artist) folder '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), folder_name, e).ok();
                        }
                    }
                }
                Err(e) => {
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][INDEX] DB error (batch upsert) folder '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), folder_name, e).ok();
                    }
                    db_error_total += batch_tracks.len() as u64;
                }
            }
        }

        // Track DB errors for this folder (scan errors already tracked above)
        if group_errors > 0 {
            if let Some(entry) = artists_with_errors.iter_mut().rev().find(|(name, _)| name == folder_name) {
                entry.1 += group_errors;
            } else {
                artists_with_errors.push((folder_name.clone(), group_errors));
            }
        }

        // --- Step 4: Cover art extraction for this artist ---
        if !args.skip_images && !releases_needing_art.is_empty() {
            print_status(folder_name, folder_idx, total_folders, &format!("extracting artwork ({} releases)...", releases_needing_art.len()));
            let art_entries: Vec<(&String, &PathBuf)> = releases_needing_art.iter().collect();
            let extracted_covers: Vec<(String, PathBuf, bool)> = art_entries
                .par_iter()
                .map(|(release_id, source_path)| {
                    let out_path = img_dir.join(format!("{}.jpg", release_id));
                    if out_path.exists() {
                        return ((*release_id).clone(), out_path, false);
                    }
                    let success = extract_cover_art(source_path, &out_path);
                    ((*release_id).clone(), out_path, success)
                })
                .collect();

            for (release_id, out_path, newly_extracted) in &extracted_covers {
                if !newly_extracted { continue; }

                if use_s3 {
                    if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                        (&s3_client, &config.s3_bucket, &config.s3_public_url)
                    {
                        let s3_key = format!("releases/{}.jpg", release_id);
                        match upload_to_s3(client, bucket, &s3_key, out_path).await {
                            Ok(_) => {
                                let image_url = format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
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
                                if let Ok(mut f) = error_log.lock() {
                                    writeln!(f, "[{}][INDEX] S3 upload failed for release {}: {:?}",
                                        Utc::now().format("%Y-%m-%d %H:%M:%S"), release_id, e).ok();
                                }
                            }
                        }
                    }
                }

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

                if !use_local && use_s3 && out_path.exists() {
                    fs::remove_file(out_path).ok();
                }
            }
        }

        // --- Step 5: Update totals for this artist's releases/artists ---
        print_status(folder_name, folder_idx, total_folders, "updating totals...");
        for aid in &folder_artist_ids {
            update_release_totals_for_artist(&pool, aid).await.ok();
            update_artist_totals_for_artist(&pool, aid).await.ok();
        }

        // --- Step 6: Save progress ---
        save_index_progress(&pool, folder_name).await.ok();
    }

    eprint!("\r\x1b[K\n\x1b[K\x1b[A"); // Clear both status lines
    println!(
        "  {} {} files in {} folders | New: {} | Updated: {} | Skipped: {} | Errors: {}",
        "✅".green(),
        total_files.to_string().bright_white(),
        total_folders.to_string().bright_white(),
        new_total.to_string().bright_green(),
        updated_total.to_string().bright_yellow(),
        skipped_total.to_string().bright_black(),
        if db_error_total + scan_error_total > 0 {
            (db_error_total + scan_error_total).to_string().red()
        } else {
            "0".to_string().bright_black()
        }
    );
    if !artists_with_errors.is_empty() {
        println!();
        for (artist_name, count) in &artists_with_errors {
            println!(
                "  {} Unable to parse {} file{} for {}. See errors.log for details.",
                "❌",
                count.to_string().red(),
                if *count == 1 { "" } else { "s" },
                artist_name.bright_white(),
            );
        }
    }
    println!();

    // --- Final: Update global statistics and clear progress ---
    println!("{} Finalizing...", "🏁");
    match update_statistics(&pool).await {
        Ok(_) => println!("  {} Updated statistics", "✅".green()),
        Err(e) => eprintln!("  {} Failed to update statistics: {}", "❌", e),
    }

    clear_index_progress(&pool).await.ok();
    println!("  {} Progress cleared", "✅".green());

    let elapsed = start.elapsed();
    println!();
    println!("{}", "═".repeat(60).bright_black());
    println!();
    println!("{} {:.1}s", "Completed in:".white().bold(), elapsed.as_secs_f64());
    println!("  {} {}", "New tracks:".green(), new_total);
    println!("  {} {}", "Updated:".yellow(), updated_total);
    println!("  {} {}", "Skipped:".bright_black(), skipped_total);
    let total_errors = scan_error_total + db_error_total;
    if total_errors > 0 {
        println!("  {} {}", "Errors:".red(), total_errors);
    }
}
