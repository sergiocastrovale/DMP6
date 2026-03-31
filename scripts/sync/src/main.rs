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
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use slug::slugify;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::time::sleep;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-sync", about = "Index local audio files and sync with MusicBrainz")]
struct Args {
    /// Override MUSIC_DIR from .env
    #[arg()]
    music_dir: Option<String>,

    /// Nuke matching data, then re-index and re-sync from scratch
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

    /// Use web/dump/test-artists as music dir (requires ./symlink-test-artists first)
    #[arg(long)]
    test: bool,

    /// Continue from last checkpoint
    #[arg(long)]
    resume: bool,

    /// Skip all image operations (cover art + artist images)
    #[arg(long)]
    skip_images: bool,

    /// Number of parallel metadata extraction workers (default: all cores)
    #[arg(long, default_value = "0")]
    threads: usize,

    /// Limit to first N artist folders (0 = no limit)
    #[arg(long, default_value = "0")]
    limit: usize,

    /// Show skipped MB releases in output
    #[arg(long)]
    verbose: bool,
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
    // MusicBrainz IDs from embedded metadata
    mb_album_id: Option<String>,
    mb_album_artist_id: Option<String>,
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
    fanart_api_key: Option<String>,
}

fn load_config(music_dir_override: &Option<String>) -> Config {
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

    let music_dir = music_dir_override
        .clone()
        .or_else(|| std::env::var("MUSIC_DIR").ok())
        .expect("MUSIC_DIR not set. Pass as argument or set in web/.env");

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");

    let project_root = std::env::var("PROJECT_ROOT")
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .ok()
                .and_then(|d| {
                    if d.ends_with("scripts/sync") {
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
    let fanart_api_key = std::env::var("FANART_API_KEY").ok().filter(|s| !s.is_empty());

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
        fanart_api_key,
    }
}

// ---------------------------------------------------------------------------
// MusicBrainz API types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct MbArtistSearchResult {
    artists: Vec<MbArtistMatch>,
}

#[derive(Debug, Clone, Deserialize)]
struct MbArtistMatch {
    id: String,
    #[allow(dead_code)]
    name: String,
    score: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupList {
    #[serde(rename = "release-groups")]
    release_groups: Vec<MbReleaseGroup>,
    #[serde(rename = "release-group-count")]
    release_group_count: Option<u32>,
    #[serde(rename = "release-group-offset")]
    #[allow(dead_code)]
    release_group_offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroup {
    id: String,
    title: String,
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(rename = "secondary-types")]
    secondary_types: Option<Vec<String>>,
    #[serde(rename = "first-release-date")]
    first_release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MbRelease {
    id: String,
    title: String,
    date: Option<String>,
    media: Option<Vec<MbMedia>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseList {
    releases: Vec<MbRelease>,
}

#[derive(Debug, Deserialize)]
struct MbMedia {
    #[allow(dead_code)]
    position: Option<u32>,
    tracks: Option<Vec<MbTrack>>,
}

#[derive(Debug, Deserialize)]
struct MbTrack {
    id: String,
    title: String,
    position: Option<u32>,
    length: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct MbArtistDetail {
    id: String,
    #[allow(dead_code)]
    name: String,
    relations: Option<Vec<MbRelation>>,
    genres: Option<Vec<MbGenre>>,
    tags: Option<Vec<MbTag>>,
}

#[derive(Debug, Deserialize)]
struct MbRelation {
    #[serde(rename = "type")]
    relation_type: String,
    url: Option<MbUrl>,
}

#[derive(Debug, Deserialize)]
struct MbUrl {
    resource: String,
}

#[derive(Debug, Deserialize)]
struct MbGenre {
    name: String,
    count: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MbTag {
    name: String,
    count: Option<i32>,
}


// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

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
    let mut mb_album_id: Option<String> = None;
    let mut mb_album_artist_id: Option<String> = None;

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

        for item in tag.items() {
            let key = match item.key() {
                lofty::tag::ItemKey::Unknown(s) => s.to_string(),
                other => format!("{:?}", other),
            };
            if let lofty::tag::ItemValue::Text(raw_val) = item.value() {
                let val = sanitize_tag(raw_val);
                let key_upper = key.to_uppercase();

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

                // MusicBrainz embedded IDs
                if mb_album_id.is_none()
                    && (key_upper == "MUSICBRAINZ_ALBUMID"
                        || key_upper == "MUSICBRAINZ ALBUM ID"
                        || key_upper == "MUSICBRAINZ_RELEASEGROUPID"
                        || key_upper == "MUSICBRAINZ RELEASE GROUP ID"
                        || key_upper.contains("MUSICBRAINZRELEASEGROUPID"))
                {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() && trimmed.len() >= 32 {
                        mb_album_id = Some(trimmed.to_string());
                    }
                }
                if mb_album_artist_id.is_none()
                    && (key_upper == "MUSICBRAINZ_ALBUMARTISTID"
                        || key_upper == "MUSICBRAINZ ALBUM ARTIST ID"
                        || key_upper.contains("MUSICBRAINZALBUMARTISTID"))
                {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() && trimmed.len() >= 32 {
                        mb_album_artist_id = Some(trimmed.to_string());
                    }
                }
                all_tags.insert(key, val.clone());
            }
        }
    }

    let props = tagged_file.properties();
    let duration = Some(props.duration().as_secs() as i32);
    let bitrate = props.audio_bitrate().map(|b| b as i32);
    let sample_rate = props.sample_rate().map(|s| s as i32);

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
        mb_album_id,
        mb_album_artist_id,
    })
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Normalize a name for filter comparison: lowercase, treat hyphens as spaces.
/// This ensures folder names ("070 Shake") and slugs ("070-shake") match the same filter.
fn normalize_filter(s: &str) -> String {
    s.to_lowercase().replace('-', " ")
}

fn matches_filter(folder: &str, from: &str, to: &str, only: &str) -> bool {
    let folder_norm = normalize_filter(folder);

    if !only.is_empty() {
        let only_norm = normalize_filter(only);
        return folder_norm.starts_with(&only_norm);
    }

    if !from.is_empty() {
        let from_norm = normalize_filter(from);
        if folder_norm < from_norm {
            return false;
        }
    }
    if !to.is_empty() {
        let to_norm = normalize_filter(to);
        let to_upper = format!("{}\u{10FFFF}", to_norm);
        if folder_norm > to_upper {
            return false;
        }
    }

    true
}

// ---------------------------------------------------------------------------
// Artist tag splitting
// ---------------------------------------------------------------------------

/// Known special MusicBrainz artist IDs that are not real artists.
const SPECIAL_MB_ARTIST_IDS: &[&str] = &[
    "89ad4ac3-39f7-470e-963a-56509c546377", // Various Artists
    "f731ccc4-e22a-43af-a747-64213329e088", // [anonymous]
    "33cf029c-63b0-41a0-9855-be2a3665fb3b", // [data]
    "314e1c25-dde7-4e4d-b2f4-0a7b032fa3c6", // [dialogue]
    "eec63d3c-3b81-4ad4-b1e4-7c147c4d2b61", // [no artist]
    "125ec42a-7229-4250-afc5-e057484327fe", // [traditional]
    "9be7f096-97ec-4615-8957-8c3b0b15e4e0", // [unknown]
];

fn is_various_artists(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "various artists" || lower == "various" || lower == "va"
}

fn is_special_mb_artist(id: &str, name: &str) -> bool {
    SPECIAL_MB_ARTIST_IDS.contains(&id) || is_various_artists(name)
}

/// Split an artist tag into individual artist names.
/// Returns (main_artists, featured_artists).
///
/// Splitting rules:
/// - Splits on "feat."/"ft."/"featuring" (case-insensitive) first to separate featured artists
/// - Then splits each side by "/" "//" "\" "\\" "|" "||" ";"
/// - Splits on "vs." / "vs" (unambiguous collaboration marker)
/// - Does NOT split on "," (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
/// - Does NOT split on "&" (too ambiguous: "Simon & Garfunkel")
/// - Trims whitespace, filters empties, deduplicates, skips "Various Artists" variants
fn split_artists(tag: &str) -> (Vec<String>, Vec<String>) {
    static FEAT_RE: OnceLock<Regex> = OnceLock::new();
    let feat_re = FEAT_RE.get_or_init(|| Regex::new(r"(?i)\s*\(\s*feat(?:uring)?\.?\s+|\s+feat(?:uring)?\.?\s+|\s*\(\s*ft\.?\s+|\s+ft\.?\s+").unwrap());

    let (main_part, feat_part) = if let Some(m) = feat_re.find(tag) {
        let main = &tag[..m.start()];
        let mut feat = &tag[m.end()..];
        if tag[m.start()..m.end()].contains('(') {
            feat = feat.trim_end_matches(')').trim();
        }
        (main.to_string(), Some(feat.to_string()))
    } else {
        (tag.to_string(), None)
    };

    // Delimiters (checked longest-first so // \\ || beat their single-char forms):
    //   // \\ || / \ | ;   — always split
    //   vs. vs              — always split (unambiguous collaboration marker)
    //   ,                   — NOT split (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
    //   &                   — NOT split (ambiguous: "Simon & Garfunkel")

    // Character-level splitter for // \\ || ; |
    // Single / and \ split only with surrounding spaces ("A / B" splits, "AC/DC" does not)
    let split_by_chars = |s: &str| -> Vec<String> {
        let mut parts: Vec<String> = Vec::new();
        let mut current = String::new();
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len();
        let mut i = 0;
        while i < len {
            let c = chars[i];
            if i + 1 < len {
                let d = chars[i + 1];
                if (c == '/' && d == '/') || (c == '\\' && d == '\\') || (c == '|' && d == '|') {
                    parts.push(current.trim().to_string());
                    current = String::new();
                    i += 2;
                    continue;
                }
            }
            if c == ';' || c == '|' {
                parts.push(current.trim().to_string());
                current = String::new();
            } else if (c == '/' || c == '\\')
                && current.ends_with(' ')
                && (i + 1 < len && chars[i + 1] == ' ')
            {
                // " / " or " \ " — split (multi-artist separator)
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

    // Compose: first split on "vs."/"vs" (regex), then split each segment by chars
    static VS_RE: OnceLock<Regex> = OnceLock::new();
    let vs_re = VS_RE.get_or_init(|| Regex::new(r"(?i)\s+vs\.?\s+").unwrap());

    let split_part = |s: &str| -> Vec<String> {
        vs_re.split(s)
            .flat_map(|seg| split_by_chars(seg))
            .collect()
    };

    let mut main_artists = split_part(&main_part);
    {
        let mut seen = HashSet::new();
        main_artists.retain(|a| seen.insert(a.to_lowercase()));
    }

    let mut featured_artists = match feat_part {
        Some(ref fp) => split_part(fp),
        None => Vec::new(),
    };
    {
        let main_lower: HashSet<String> =
            main_artists.iter().map(|a| a.to_lowercase()).collect();
        let mut seen = HashSet::new();
        featured_artists.retain(|a| {
            let lower = a.to_lowercase();
            !main_lower.contains(&lower) && seen.insert(lower)
        });
    }

    (main_artists, featured_artists)
}

// ---------------------------------------------------------------------------
// Cover art extraction (from audio file metadata)
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
            match image::load_from_memory(data) {
                Ok(img) => {
                    let resized = img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
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

/// Try to use a folder image (cover.jpg, folder.jpg, or front.jpg) as release cover art.
/// Resizes and saves to `output_path`. Returns the filename found, or None.
fn use_folder_image(folder_path: &Path, output_path: &Path) -> Option<&'static str> {
    for name in &["cover.jpg", "folder.jpg", "front.jpg", "Cover.jpg", "Folder.jpg", "Front.jpg"] {
        let candidate = folder_path.join(name);
        if candidate.is_file() {
            match image::open(&candidate) {
                Ok(img) => {
                    let resized = img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
                    if let Some(parent) = output_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    if resized.save(output_path).is_ok() {
                        return Some(name);
                    }
                }
                Err(_) => continue,
            }
        }
    }
    None
}

/// Try to use a local image from the artist folder as artist image.
/// Checks folder.jpg, cover.jpg first, then falls back to any jpg/png in the root.
/// Resizes and saves to `output_path`. Returns true if found and saved.
fn use_artist_folder_image(artist_folder: &Path, output_path: &Path) -> bool {
    // Priority names first
    for name in &["folder.jpg", "cover.jpg", "Folder.jpg", "Cover.jpg"] {
        let candidate = artist_folder.join(name);
        if candidate.is_file() {
            if let Ok(img) = image::open(&candidate) {
                let resized = img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if resized.save(output_path).is_ok() {
                    return true;
                }
            }
        }
    }

    // Fallback: first jpg/png found in the root of the artist folder
    if let Ok(entries) = fs::read_dir(artist_folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "jpg" || ext_lower == "jpeg" || ext_lower == "png" {
                    if let Ok(img) = image::open(&path) {
                        let resized = img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
                        if let Some(parent) = output_path.parent() {
                            fs::create_dir_all(parent).ok();
                        }
                        if resized.save(output_path).is_ok() {
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}

/// Download cover art from Cover Art Archive for a release group.
/// Saves resized image to `output_path` and also writes `folder.jpg` into `source_folder`.
/// Returns (downloaded, wrote_folder_jpg).
async fn download_cover_art(
    client: &Client,
    release_group_id: &str,
    output_path: &Path,
    source_folder: &Path,
) -> Result<(bool, bool), String> {
    let url = format!(
        "https://coverartarchive.org/release-group/{}/front",
        release_group_id
    );

    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;

    if !resp.status().is_success() {
        return Ok((false, false));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("read failed: {}", e))?;

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("invalid image: {}", e))?;

    let resized = img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    resized.save(output_path).map_err(|e| format!("save failed: {}", e))?;

    // Also save full-resolution folder.jpg in the source folder
    let mut wrote_folder_jpg = false;
    let folder_jpg = source_folder.join("folder.jpg");
    if !folder_jpg.exists() {
        if let Ok(full_img) = image::load_from_memory(&bytes) {
            if full_img.save(&folder_jpg).is_ok() {
                wrote_folder_jpg = true;
            }
        }
    }

    Ok((true, wrote_folder_jpg))
}

// ---------------------------------------------------------------------------
// Adaptive rate limiter (MusicBrainz API)
// ---------------------------------------------------------------------------

struct RateLimiter {
    delay_ms: u64,
    min_delay: u64,
    max_delay: u64,
    last_request: Instant,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            delay_ms: 1000,
            min_delay: 1000,
            max_delay: 10000,
            last_request: Instant::now(),
        }
    }

    async fn wait(&mut self) {
        let elapsed = self.last_request.elapsed().as_millis() as u64;
        if elapsed < self.delay_ms {
            sleep(Duration::from_millis(self.delay_ms - elapsed)).await;
        }
        self.last_request = Instant::now();
    }

    fn on_success(&mut self) {
        if self.delay_ms > self.min_delay {
            self.delay_ms = (self.delay_ms * 85 / 100).max(self.min_delay);
        }
    }

    fn on_rate_limit(&mut self) {
        self.delay_ms = (self.delay_ms * 2).min(self.max_delay);
    }
}

// ---------------------------------------------------------------------------
// MusicBrainz API client
// ---------------------------------------------------------------------------

const MB_BASE: &str = "https://musicbrainz.org/ws/2";
const USER_AGENT: &str = "DMPv6/0.1.0 ( https://github.com/dmp )";

async fn mb_get(
    client: &Client,
    url: &str,
    limiter: &mut RateLimiter,
) -> Result<String, String> {
    let max_attempts = 10;
    let mut wait_time = limiter.delay_ms;

    for attempt in 0..max_attempts {
        limiter.wait().await;

        let resp = client
            .get(url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = resp.status().as_u16();

        if status == 200 {
            limiter.on_success();
            return resp.text().await.map_err(|e| format!("Read body failed: {}", e));
        }

        if status == 503 || status == 429 {
            limiter.on_rate_limit();

            if attempt < max_attempts - 1 {
                wait_time = (wait_time * 2).min(60000);
                let reason = if status == 503 { "MB server busy" } else { "Rate limited" };
                eprint!(
                    "\r  {} - waiting {:.1}s before retry {}/{}...          ",
                    reason, wait_time as f64 / 1000.0, attempt + 1, max_attempts - 1
                );
                sleep(Duration::from_millis(wait_time)).await;
                continue;
            } else {
                eprintln!();
                return Err(format!(
                    "MusicBrainz API still unavailable after {} retries (waited up to {}s). Will retry this release next time.",
                    max_attempts,
                    wait_time / 1000
                ));
            }
        }

        return Err(format!("HTTP {} for {}", status, url));
    }

    Err("Max retries exceeded".to_string())
}

fn normalize_name(name: &str) -> String {
    let s = name.to_lowercase();
    let s = s.strip_prefix("the ").unwrap_or(&s);
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn names_are_similar(query: &str, result: &str) -> bool {
    let q_norm = normalize_name(query);
    let r_norm = normalize_name(result);

    if q_norm == r_norm {
        return true;
    }

    let q_words: Vec<&str> = q_norm.split_whitespace().collect();
    let r_words: Vec<&str> = r_norm.split_whitespace().collect();

    if q_words.len() == 1 || r_words.len() == 1 {
        return false;
    }

    let q_set: HashSet<&str> = q_words.iter().copied().collect();
    let r_set: HashSet<&str> = r_words.iter().copied().collect();
    let intersection = q_set.intersection(&r_set).count();
    let union = q_set.union(&r_set).count();
    if union == 0 {
        return true;
    }
    (intersection as f64 / union as f64) >= 0.5
}

/// Check if `artist_name` is a compound/collaboration name that resolved to
/// `match_name` (one of its component artists).  Returns false for simple name
/// variations like "Godley And Creme" → "Godley & Creme".
fn is_likely_compound_of(artist_name: &str, match_name: &str) -> bool {
    let an = normalize_name(artist_name);
    let mn = normalize_name(match_name);
    if an == mn { return false; }

    let lower = artist_name.to_lowercase();

    // Unambiguous compound separators — always indicate multiple artists
    if lower.contains(" vs ") || lower.contains(" vs. ")
        || lower.contains(" – ") || lower.contains(" // ")
        || lower.contains(" | ") || lower.contains(" x ") {
        return true;
    }

    // Ambiguous separator: "&" only counts as compound if the match is a proper
    // subset of the artist name (the artist name has words beyond the match).
    // "10cc & Godley & Creme" → "Godley & Creme": {godley,creme} ⊂ {10cc,godley,creme} → compound
    // "Simon & Garfunkel" → "Simon & Garfunkel": same normalized → caught by an==mn above
    if lower.contains(" & ") {
        let an_words: HashSet<&str> = an.split_whitespace().collect();
        let mn_words: HashSet<&str> = mn.split_whitespace().collect();
        if mn_words.is_subset(&an_words) && mn_words.len() < an_words.len() {
            return true;
        }
    }

    // No separator found — this is a name variation (e.g. "FŒHN" → "Fœhn Trio",
    // "Hävok Ünit" → "Havoc Unit"), not a compound.
    false
}

async fn mb_search_artist(
    client: &Client,
    name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    let phrase = format!("\"{}\"", name);
    let quoted = urlencoding::encode(&phrase);
    let url = format!("{}/artist/?query=artist:{}&limit=5&fmt=json", MB_BASE, quoted);
    let body = mb_get(client, &url, limiter).await?;
    let result: MbArtistSearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    Ok(result
        .artists
        .into_iter()
        .find(|a| a.score.unwrap_or(0) >= 90 && names_are_similar(name, &a.name)))
}

/// Returns (primary_match, additional_matches_from_split).
/// The primary match is the one for the queried artist name.
/// Additional matches are other artists found from credits or splitting compound names.
///
/// Algorithm:
///   1. If we have an embedded MB album artist ID → direct lookup (source of truth)
///   2. If we have an embedded MB album ID → look up the release group to get its artist credits
///   3. Search MB by artist name (stored DB name)
///   4. Search MB by raw 'artist' tag from audio file
///   5. Search MB for a release-group by album title + artist name → use artist-credit array
///   6. Split raw 'albumArtist' tag by unambiguous separators and search each part
async fn find_mb_match_with_fallback(
    client: &Client,
    pool: &PgPool,
    artist_id: &str,
    artist_name: &str,
    mb_hint_artist_id: Option<&str>,
    mb_hint_album_id: Option<&str>,
    limiter: &mut RateLimiter,
) -> Result<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>), String> {
    // Step 1: direct lookup via embedded MUSICBRAINZ_ALBUMARTISTID
    if let Some(mb_aid) = mb_hint_artist_id {
        if SPECIAL_MB_ARTIST_IDS.contains(&mb_aid) {
            println!("    {} Skipping special MB artist ID: {}", "→".bright_black(), mb_aid.bright_black());
        } else {
            match mb_lookup_artist(client, mb_aid, limiter).await {
                Ok(m) if is_special_mb_artist(&m.id, &m.name) => {
                    println!("    {} Skipping special artist from embedded ID: {} ({})",
                        "→".bright_black(), m.name.bright_black(), m.id.bright_black());
                }
                Ok(m) => {
                    println!("    {} Found via embedded MB artist ID: {} ({})",
                        "✓".green(), m.name.bright_white(), m.id.bright_black());
                    return Ok((Some(m), Vec::new()));
                }
                Err(e) => {
                    println!("    {} Embedded MB artist ID lookup failed: {}", "✗".yellow(), e.bright_black());
                }
            }
        }
    }

    // Step 2: lookup via embedded MUSICBRAINZ_ALBUMID → get artist credits from release group
    if let Some(mb_rid) = mb_hint_album_id {
        match mb_lookup_release_group_artist(client, mb_rid, limiter).await {
            Ok(artists) if !artists.is_empty() => {
                // Filter out special artists from credits
                let real_artists: Vec<MbArtistMatch> = artists.into_iter()
                    .filter(|a| !is_special_mb_artist(&a.id, &a.name))
                    .collect();
                if !real_artists.is_empty() {
                    // Pick the credit matching the searched artist as primary.
                    // On a multi-artist compilation, the first credit may be a
                    // different artist entirely (e.g. searching "Bethzaida" but
                    // first credit is "…and Oceans").
                    if let Some(matched) = real_artists.iter()
                        .find(|a| names_are_similar(artist_name, &a.name) || a.name.eq_ignore_ascii_case(artist_name))
                    {
                        let primary = matched.clone();
                        println!("    {} Found via embedded MB album ID: {} ({})",
                            "✓".green(), primary.name.bright_white(), primary.id.bright_black());
                        let additional: Vec<(String, MbArtistMatch)> = real_artists.iter()
                            .filter(|a| a.id != primary.id)
                            .map(|a| (a.name.clone(), a.clone()))
                            .collect();
                        return Ok((Some(primary), additional));
                    }
                    // No credit matches the searched name — don't use this result.
                    // Fall through to name-based search (Step 3+).
                } else {
                    println!("    {} Embedded MB album ID returned only special artists, skipping",
                        "→".bright_black());
                }
            }
            Ok(_) => {
                println!("    {} Embedded MB album ID returned no artists", "✗".yellow());
            }
            Err(e) => {
                println!("    {} Embedded MB album ID lookup failed: {}", "✗".yellow(), e.bright_black());
            }
        }
    }

    // Step 3: search MB by stored artist name
    if let Some(m) = mb_search_artist(client, artist_name, limiter).await? {
        println!("    {} Found: {} ({})", "✓".green(), m.name.bright_white(), m.id.bright_black());
        return Ok((Some(m), Vec::new()));
    }

    // Fetch distinct (artist_tag, albumArtist_tag, album_title) combos for this artist.
    // Different tracks may have different compound tags (e.g. one album credits
    // "070 Shake & Christine and the Queens", another credits "070 Shake\\NLE Choppa").
    // Searches both LocalReleaseArtist (album-level) and TrackArtist (track-level) links.
    let tag_rows: Vec<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT DISTINCT lrt.artist, lrt."albumArtist", lr.title
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
           WHERE EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" lra
               WHERE lra."localReleaseId" = lr.id AND lra."artistId" = $1
           ) OR EXISTS (
               SELECT 1 FROM "TrackArtist" ta
               WHERE ta."trackId" = lrt.id AND ta."artistId" = $1
           )"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Build deduplicated list of (tag, album_title) pairs to try for Steps 4-6.
    // `artist_name` itself may be a compound tag (e.g. "070 Shake & Christine and the Queens"),
    // so include it as a candidate. Also collect distinct raw `artist` and `albumArtist` tags.
    let mut all_tags: Vec<(String, Option<String>)> = Vec::new();
    let mut seen_tags: HashSet<String> = HashSet::new();

    // artist_name itself — always first (grab album title from first tag row)
    {
        let key = artist_name.to_lowercase();
        seen_tags.insert(key);
        let title = tag_rows.first().and_then(|(_, _, t)| t.clone());
        all_tags.push((artist_name.to_string(), title));
    }

    for (raw_artist, raw_album_artist, album_title) in &tag_rows {
        // artist tag
        if let Some(a) = raw_artist {
            let a = a.trim();
            if !a.is_empty() {
                let key = a.to_lowercase();
                if seen_tags.insert(key) {
                    all_tags.push((a.to_string(), album_title.clone()));
                }
            }
        }
        // albumArtist tag
        if let Some(aa) = raw_album_artist {
            let aa = aa.trim();
            if !aa.is_empty() {
                let key = aa.to_lowercase();
                if seen_tags.insert(key) {
                    all_tags.push((aa.to_string(), album_title.clone()));
                }
            }
        }
    }

    // Filter all_tags: only keep tags related to artist_name (containment or similarity).
    // This prevents unrelated tags (e.g. albumArtist "070 Shake" for track artist "070phi")
    // from being tried in Steps 4, 5, and 6.
    let artist_name_norm = normalize_name(artist_name);
    let artist_words: HashSet<String> = artist_name_norm.split_whitespace().map(|s| s.to_string()).collect();
    all_tags.retain(|(tag, _)| {
        if tag.eq_ignore_ascii_case(artist_name) {
            return true; // always keep the artist's own name
        }
        let tag_norm = normalize_name(tag);
        let tag_words: HashSet<&str> = tag_norm.split_whitespace().collect();
        let artist_word_refs: HashSet<&str> = artist_words.iter().map(|s| s.as_str()).collect();
        // Keep if one is a subset of the other (containment) or similar
        tag_words.is_subset(&artist_word_refs)
            || artist_word_refs.is_subset(&tag_words)
            || names_are_similar(artist_name, tag)
    });

    // Step 4: try raw tags (excluding artist_name itself) as single artist names
    let mut early_primary: Option<MbArtistMatch> = None;
    for (tag, _) in &all_tags {
        if tag.eq_ignore_ascii_case(artist_name) {
            continue;
        }
        if let Some(m) = mb_search_artist(client, tag, limiter).await? {
            println!(
                "    {} Found via raw tag: {} ({})",
                "✓".green(), m.name.bright_white(), m.id.bright_black()
            );
            early_primary = Some(m);
            break;
        }
    }

    // Step 5: search MB for a release-group by album title + tag,
    // use the structured artist-credit array to resolve compound names.
    // This avoids ambiguous string splitting (e.g. "Kool & the Gang" stays as one artist,
    // while "…and Oceans vs. Bloodthorn" correctly yields two).
    for (tag, album_title) in &all_tags {
        if let Some(ref title) = album_title {
            if let Some(result) = try_release_group_credits(
                client, title, tag, &early_primary, limiter,
            ).await? {
                return Ok(result);
            }
        }
    }

    // Step 6 (last resort): split tags by unambiguous separators only.
    // Ambiguous separators (&, ,) are NOT used here — they are handled by Step 5's
    // structured artist-credit approach instead.
    for (tag, _) in &all_tags {
        if let Some(result) = try_split_tag(
            client, tag, artist_name, &early_primary, limiter,
        ).await? {
            return Ok(result);
        }
    }

    // Step 4 found a match but no split/credit worked — return it as sole match
    if early_primary.is_some() {
        return Ok((early_primary, Vec::new()));
    }

    println!("    {} No match found", "✗".red());
    Ok((None, Vec::new()))
}

/// Step 5 helper: search MB for a release-group by album title + artist tag,
/// return resolved artists from the artist-credit array.
async fn try_release_group_credits(
    client: &Client,
    album_title: &str,
    artist_tag: &str,
    early_primary: &Option<MbArtistMatch>,
    limiter: &mut RateLimiter,
) -> Result<Option<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>)>, String> {
    let credits = mb_search_release_group_credits(client, album_title, artist_tag, limiter).await
        .unwrap_or_default();
    let real_credits: Vec<MbArtistMatch> = credits.into_iter()
        .filter(|a| !is_special_mb_artist(&a.id, &a.name))
        .collect();
    if real_credits.is_empty() {
        return Ok(None);
    }

    // Validate: at least one credit name must be related to the artist_tag.
    // This prevents "070phi" from accepting credits for "070 Shake" just because
    // the release-group search returned a fuzzy match.
    let tag_norm = normalize_name(artist_tag);
    let tag_words: HashSet<&str> = tag_norm.split_whitespace().collect();
    let any_credit_matches = real_credits.iter().any(|c| {
        let c_norm = normalize_name(&c.name);
        let c_words: HashSet<&str> = c_norm.split_whitespace().collect();
        c_words.is_subset(&tag_words) || tag_words.is_subset(&c_words)
            || names_are_similar(artist_tag, &c.name)
    });
    if !any_credit_matches {
        return Ok(None);
    }

    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut primary: Option<MbArtistMatch> = None;
    let mut additional: Vec<(String, MbArtistMatch)> = Vec::new();
    let mut found_new = false;

    if let Some(ref ep) = early_primary {
        seen_ids.insert(ep.id.clone());
        primary = Some(ep.clone());
    }

    for credit in real_credits {
        if seen_ids.contains(&credit.id) {
            continue;
        }
        found_new = true;
        seen_ids.insert(credit.id.clone());
        if primary.is_none() {
            println!("    {} Found via release-group credits: {} ({})",
                "✓".green(), credit.name.bright_white(), credit.id.bright_black());
            primary = Some(credit);
        } else {
            additional.push((credit.name.clone(), credit));
        }
    }

    // Only return if credits provided new information beyond early_primary.
    // If credits just confirmed what we already knew, let later steps try splitting.
    if primary.is_some() && (early_primary.is_none() || found_new) {
        Ok(Some((primary, additional)))
    } else {
        Ok(None)
    }
}

/// Step 6 helper: split a compound tag by separators and search each part.
/// Unambiguous separators are always tried. Ambiguous separators (& ,) are only
/// tried when `early_primary` is set — having a confirmed anchor artist means
/// the remaining parts after splitting are likely real additional artists.
/// This prevents "Kool & the Gang" from being split (no early_primary, Step 3 finds it directly).
async fn try_split_tag(
    client: &Client,
    tag: &str,
    artist_name: &str,
    early_primary: &Option<MbArtistMatch>,
    limiter: &mut RateLimiter,
) -> Result<Option<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>)>, String> {
    let mut separators: Vec<&str> = vec![
        "// ", "//",
        "\\\\ ", "\\\\",
        "|| ", "||",
        " feat. ", " feat ",
        " vs. ", " vs ",
        " – ",
        " / ", " \\ ",
        "| ", "|",
        "; ", ";",
    ];
    // Only try ambiguous separators (no surrounding spaces) when we have a
    // confirmed anchor artist. Prevents "AC/DC", "Kool & the Gang" from splitting
    // when the full name matches on MB directly (Step 3).
    if early_primary.is_some() {
        separators.extend_from_slice(&["/", "\\", " & ", ", "]);
    }

    for sep in &separators {
        let parts: Vec<&str> = tag
            .split(sep)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }

        // If artist_name appears as one of the split parts (e.g. "A feat. artist_name"),
        // this tag won't help us find artist_name's MB match — the other parts are
        // different artists. Skip this separator.
        if parts.iter().any(|p| p.eq_ignore_ascii_case(artist_name)) {
            continue;
        }

        let mut primary: Option<MbArtistMatch> = None;
        let mut additional: Vec<(String, MbArtistMatch)> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        if let Some(ref ep) = early_primary {
            seen_ids.insert(ep.id.clone());
            primary = Some(ep.clone());
        }

        for part in &parts {
            if let Some(ref ep) = early_primary {
                if part.eq_ignore_ascii_case(&ep.name) {
                    continue;
                }
            }
            if let Some(m) = mb_search_artist(client, part, limiter).await? {
                if seen_ids.contains(&m.id) {
                    continue;
                }
                seen_ids.insert(m.id.clone());
                if primary.is_none() {
                    primary = Some(m);
                } else {
                    additional.push((part.to_string(), m));
                }
            }
        }

        if primary.is_some() {
            return Ok(Some((primary, additional)));
        }
    }

    Ok(None)
}

/// Look up an artist directly by MB ID (no search needed).
/// Returns name + id for setting musicbrainzId on the Artist record.
async fn mb_lookup_artist(
    client: &Client,
    mb_artist_id: &str,
    limiter: &mut RateLimiter,
) -> Result<MbArtistMatch, String> {
    let url = format!(
        "{}/artist/{}?fmt=json",
        MB_BASE, mb_artist_id
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(Deserialize)]
    struct ArtistLookup { id: String, name: String }

    let a: ArtistLookup = serde_json::from_str(&body)
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(MbArtistMatch { id: a.id, name: a.name, score: Some(100) })
}

/// Look up a release group by MB ID and return its artist credits.
async fn mb_lookup_release_group_artist(
    client: &Client,
    mb_release_group_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbArtistMatch>, String> {
    let url = format!(
        "{}/release-group/{}?inc=artist-credits&fmt=json",
        MB_BASE, mb_release_group_id
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(Deserialize)]
    struct ArtistCredit { artist: ArtistRef }
    #[derive(Deserialize)]
    struct ArtistRef { id: String, name: String }
    #[derive(Deserialize)]
    struct RgLookup {
        #[serde(rename = "artist-credit")]
        artist_credit: Option<Vec<ArtistCredit>>,
    }

    let rg: RgLookup = serde_json::from_str(&body)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(rg.artist_credit.unwrap_or_default().into_iter().map(|ac| {
        MbArtistMatch { id: ac.artist.id, name: ac.artist.name, score: Some(100) }
    }).collect())
}

/// Search for a release-group by album title + artist name, return artist-credit entries.
/// Uses the structured artist-credit array from MB to resolve compound artist names
/// without ambiguous string splitting (e.g. "Kool & the Gang" stays as one artist).
async fn mb_search_release_group_credits(
    client: &Client,
    album_title: &str,
    artist_name: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbArtistMatch>, String> {
    let query = format!(
        "releasegroup:\"{}\" AND artist:\"{}\"",
        album_title.replace('"', ""),
        artist_name.replace('"', ""),
    );
    let encoded = urlencoding::encode(&query);
    let url = format!("{}/release-group/?query={}&limit=1&fmt=json", MB_BASE, encoded);
    let body = mb_get(client, &url, limiter).await?;

    #[derive(Deserialize)]
    struct ArtistRef { id: String, name: String }
    #[derive(Deserialize)]
    struct ArtistCredit { artist: ArtistRef }
    #[derive(Deserialize)]
    struct RgResult {
        #[serde(rename = "artist-credit")]
        artist_credit: Option<Vec<ArtistCredit>>,
        score: Option<u32>,
    }
    #[derive(Deserialize)]
    struct SearchResult {
        #[serde(rename = "release-groups")]
        release_groups: Option<Vec<RgResult>>,
    }

    let result: SearchResult = serde_json::from_str(&body)
        .map_err(|e| format!("Parse error: {}", e))?;

    let rgs = result.release_groups.unwrap_or_default();
    if let Some(rg) = rgs.into_iter().next() {
        if rg.score.unwrap_or(0) >= 80 {
            return Ok(rg.artist_credit.unwrap_or_default().into_iter().map(|ac| {
                MbArtistMatch { id: ac.artist.id, name: ac.artist.name, score: Some(100) }
            }).collect());
        }
    }

    Ok(Vec::new())
}

async fn mb_get_artist_detail(
    client: &Client,
    mb_id: &str,
    limiter: &mut RateLimiter,
) -> Result<MbArtistDetail, String> {
    let url = format!(
        "{}/artist/{}?inc=url-rels+genres+tags&fmt=json",
        MB_BASE, mb_id
    );
    let body = mb_get(client, &url, limiter).await?;
    serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))
}

async fn mb_get_release_groups(
    client: &Client,
    mb_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbReleaseGroup>, String> {
    let mut all_groups = Vec::new();
    let mut offset = 0u32;
    let limit = 100u32;

    loop {
        let url = format!(
            "{}/release-group?artist={}&limit={}&offset={}&fmt=json",
            MB_BASE, mb_id, limit, offset
        );
        let body = mb_get(client, &url, limiter).await?;
        let result: MbReleaseGroupList =
            serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

        let count = result.release_groups.len() as u32;
        all_groups.extend(result.release_groups);

        let total = result.release_group_count.unwrap_or(0);
        offset += count;
        if offset >= total || count == 0 {
            break;
        }
    }

    Ok(all_groups)
}

async fn mb_get_release_tracks(
    client: &Client,
    release_group_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<(MbRelease, Vec<MbTrack>)>, String> {
    let url = format!(
        "{}/release?release-group={}&inc=recordings&limit=10&fmt=json",
        MB_BASE, release_group_id
    );
    let body = mb_get(client, &url, limiter).await?;
    let result: MbReleaseList =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    let mut releases = Vec::new();
    for release in result.releases {
        let mut tracks = Vec::new();
        if let Some(ref media) = release.media {
            for medium in media {
                if let Some(ref trks) = medium.tracks {
                    for trk in trks {
                        tracks.push(MbTrack {
                            id: trk.id.clone(),
                            title: trk.title.clone(),
                            position: trk.position,
                            length: trk.length,
                        });
                    }
                }
            }
        }
        releases.push((release, tracks));
    }

    Ok(releases)
}

// ---------------------------------------------------------------------------
// Release type filtering
// ---------------------------------------------------------------------------

fn should_skip_release(rg: &MbReleaseGroup) -> Option<String> {
    let skip_types = ["Single", "Bootleg", "Demo", "Interview", "Broadcast"];

    if let Some(ref pt) = rg.primary_type {
        if skip_types.iter().any(|&s| pt.eq_ignore_ascii_case(s)) {
            return Some(format!("{}", pt));
        }
    }

    if let Some(ref sts) = rg.secondary_types {
        for st in sts {
            if skip_types.iter().any(|&s| st.eq_ignore_ascii_case(s)) {
                return Some(format!("{}", st));
            }
        }
    }

    None
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
            aws_sdk_s3::config::Credentials::new(key, secret, None, None, "dmp-sync")
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

async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) {
    client.delete_object().bucket(bucket).key(key).send().await.ok();
}

/// Upload a release image to S3 and update the DB. Returns true if successful.
async fn upload_release_image_to_s3(
    s3_client: &S3Client,
    bucket: &str,
    public_url: &str,
    pool: &PgPool,
    release_id: &str,
    file_path: &Path,
) -> bool {
    let s3_key = format!("releases/{}.jpg", release_id);
    match upload_to_s3(s3_client, bucket, &s3_key, file_path).await {
        Ok(_) => {
            let image_url = format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
            sqlx::query(
                r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
            )
            .bind(&image_url)
            .bind(release_id)
            .execute(pool)
            .await
            .ok();
            true
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Database operations — indexing
// ---------------------------------------------------------------------------

fn make_slug(name: &str) -> String {
    let s = slugify(name);
    if s.is_empty() {
        // Fallback for names with no alphanumeric chars (e.g. "!!!")
        let mut hasher = Md5::new();
        hasher.update(name.as_bytes());
        format!("artist-{:x}", hasher.finalize())
    } else {
        s
    }
}

async fn ensure_artist(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let artist_slug = make_slug(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
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

async fn ensure_artist_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    let artist_slug = make_slug(name);
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
    title: &str,
    year: Option<i32>,
    folder_path: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "LocalRelease" (id, title, year, "matchStatus", "forcedComplete", "totalPlayCount", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath")
           VALUES ($1, $2, $3, 'UNKNOWN', false, 0, 0, 0, $4, $4, $5)
           ON CONFLICT (title, "folderPath") DO UPDATE SET year = COALESCE(EXCLUDED.year, "LocalRelease".year), "updatedAt" = $4
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(year)
    .bind(now)
    .bind(folder_path)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

async fn ensure_local_release_cached(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    folder_path: &str,
    cache: &mut HashMap<(String, String), String>,
) -> Result<String, sqlx::Error> {
    let key = (folder_path.to_string(), title.to_string());
    if let Some(id) = cache.get(&key) {
        return Ok(id.clone());
    }

    let id = ensure_local_release(pool, title, year, folder_path).await?;
    cache.insert(key, id.clone());
    Ok(id)
}

async fn batch_upsert_tracks(
    pool: &PgPool,
    tracks: &[(&TrackMeta, String)],
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

async fn batch_ensure_track_artists(
    pool: &PgPool,
    links: &[(String, String, String)],
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
// Database operations — MusicBrainz sync
// ---------------------------------------------------------------------------

async fn ensure_release_type(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let type_slug = slugify(name);
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&type_slug)
    .bind(now)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

async fn ensure_genre(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "Genre" (id, name) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

async fn ensure_release_type_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    let type_slug = slugify(name);
    if let Some(id) = cache.get(&type_slug) {
        return Ok(id.clone());
    }
    let id = ensure_release_type(pool, name).await?;
    cache.insert(type_slug, id.clone());
    Ok(id)
}

async fn ensure_genre_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(name) {
        return Ok(id.clone());
    }
    let id = ensure_genre(pool, name).await?;
    cache.insert(name.to_string(), id.clone());
    Ok(id)
}

async fn upsert_mb_release(
    pool: &PgPool,
    title: &str,
    type_id: &str,
    year: Option<i32>,
    mb_id: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "MusicBrainzRelease"
           (id, title, "typeId", year, "musicbrainzId", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'UNKNOWN', $6, $6)
           ON CONFLICT ("musicbrainzId") DO UPDATE SET
             "typeId" = EXCLUDED."typeId", year = EXCLUDED.year,
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(type_id)
    .bind(year)
    .bind(mb_id)
    .bind(now)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

async fn ensure_mb_release_artist_link(
    pool: &PgPool,
    release_id: &str,
    artist_id: &str,
) -> Result<(), sqlx::Error> {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId")
           VALUES ($1, $2, $3)
           ON CONFLICT ("releaseId", "artistId") DO NOTHING"#,
    )
    .bind(&id)
    .bind(release_id)
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn batch_insert_mb_tracks(
    pool: &PgPool,
    release_id: &str,
    tracks: &[MbTrack],
    disc_number: i32,
) -> Result<(), sqlx::Error> {
    if tracks.is_empty() {
        return Ok(());
    }

    let mut ids: Vec<String> = Vec::with_capacity(tracks.len());
    let mut titles: Vec<String> = Vec::with_capacity(tracks.len());
    let mut positions: Vec<Option<i32>> = Vec::with_capacity(tracks.len());
    let mut disc_numbers: Vec<Option<i32>> = Vec::with_capacity(tracks.len());
    let mut durations: Vec<Option<i32>> = Vec::with_capacity(tracks.len());
    let mut mb_ids: Vec<String> = Vec::with_capacity(tracks.len());
    let mut release_ids: Vec<String> = Vec::with_capacity(tracks.len());
    let now = Utc::now().naive_utc();
    let mut timestamps: Vec<NaiveDateTime> = Vec::with_capacity(tracks.len());

    for track in tracks {
        ids.push(cuid2::create_id());
        titles.push(track.title.clone());
        positions.push(track.position.map(|p| p as i32));
        disc_numbers.push(Some(disc_number));
        durations.push(track.length.map(|l| l as i32));
        mb_ids.push(track.id.clone());
        release_ids.push(release_id.to_string());
        timestamps.push(now);
    }

    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseTrack"
           (id, title, position, "discNumber", "durationMs", "musicbrainzId", "releaseId", "createdAt", "updatedAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[], $8::timestamp[], $9::timestamp[])
           ON CONFLICT DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&titles)
    .bind(&positions)
    .bind(&disc_numbers)
    .bind(&durations)
    .bind(&mb_ids)
    .bind(&release_ids)
    .bind(&timestamps)
    .bind(&timestamps)
    .execute(pool)
    .await?;

    Ok(())
}

async fn delete_mb_tracks_for_release(
    pool: &PgPool,
    release_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"DELETE FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(release_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Batch insert artist-genre links via UNNEST.
async fn batch_link_artist_genres(
    pool: &PgPool,
    artist_id: &str,
    genre_ids: &[String],
) -> Result<(), sqlx::Error> {
    if genre_ids.is_empty() {
        return Ok(());
    }
    let artist_ids: Vec<String> = vec![artist_id.to_string(); genre_ids.len()];
    sqlx::query(
        r#"INSERT INTO "_ArtistGenres" ("A", "B")
           SELECT * FROM UNNEST($1::text[], $2::text[])
           ON CONFLICT DO NOTHING"#,
    )
    .bind(&artist_ids)
    .bind(genre_ids)
    .execute(pool)
    .await?;
    Ok(())
}

/// Batch insert artist URLs via UNNEST.
async fn batch_upsert_artist_urls(
    pool: &PgPool,
    artist_id: &str,
    urls: &[(String, String)], // (type, url)
) -> Result<(), sqlx::Error> {
    if urls.is_empty() {
        return Ok(());
    }
    let now = Utc::now().naive_utc();
    let ids: Vec<String> = urls.iter().map(|_| cuid2::create_id()).collect();
    let types: Vec<String> = urls.iter().map(|(t, _)| t.clone()).collect();
    let url_vals: Vec<String> = urls.iter().map(|(_, u)| u.clone()).collect();
    let artist_ids: Vec<String> = vec![artist_id.to_string(); urls.len()];
    let timestamps: Vec<NaiveDateTime> = vec![now; urls.len()];
    sqlx::query(
        r#"INSERT INTO "ArtistUrl" (id, type, url, "artistId", "createdAt", "updatedAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamp[], $6::timestamp[])
           ON CONFLICT ("artistId", type, url) DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&types)
    .bind(&url_vals)
    .bind(&artist_ids)
    .bind(&timestamps)
    .bind(&timestamps)
    .execute(pool)
    .await?;
    Ok(())
}

/// Batch insert LocalReleaseArtist links via UNNEST.
async fn batch_ensure_local_release_artists(
    pool: &PgPool,
    links: &[(String, String)], // (release_id, artist_id)
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }
    let now = Utc::now().naive_utc();
    let ids: Vec<String> = links.iter().map(|_| cuid2::create_id()).collect();
    let release_ids: Vec<String> = links.iter().map(|(r, _)| r.clone()).collect();
    let artist_ids: Vec<String> = links.iter().map(|(_, a)| a.clone()).collect();
    let timestamps: Vec<NaiveDateTime> = vec![now; links.len()];
    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamp[])
           ON CONFLICT ("localReleaseId", "artistId") DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&release_ids)
    .bind(&artist_ids)
    .bind(&timestamps)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Overwrite / nuke
// ---------------------------------------------------------------------------

async fn nuke_artists(pool: &PgPool, from: &str, to: &str, only: &str, project_root: &str, s3_client: &Option<S3Client>, config: &Config) -> Result<u64, sqlx::Error> {
    let artist_img_dir = PathBuf::from(project_root).join("web/public/img/artists");
    let release_img_dir = PathBuf::from(project_root).join("web/public/img/releases");
    let use_local = config.image_storage == "local" || config.image_storage == "both";
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";

    // id, slug, image (local filename), imageUrl (S3 URL)
    let artists: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT id, slug, image, "imageUrl" FROM "Artist""#,
    )
    .fetch_all(pool)
    .await?;

    // Collect the directly-targeted artist IDs — match on name (not slug,
    // since slugify strips punctuation like leading dots in "...And Oceans")
    let artists_with_names: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, name FROM "Artist""#,
    )
    .fetch_all(pool)
    .await?;
    let mut target_ids: Vec<String> = Vec::new();
    for (artist_id, name) in &artists_with_names {
        if matches_filter(name, from, to, only) {
            target_ids.push(artist_id.clone());
        }
    }

    if target_ids.is_empty() {
        return Ok(0);
    }

    // Find ALL releases linked to the targeted artists
    let shared_release_ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lra."localReleaseId" FROM "LocalReleaseArtist" lra
           WHERE lra."artistId" = ANY($1::text[])"#,
    )
    .bind(&target_ids)
    .fetch_all(pool)
    .await?;
    let release_ids: Vec<String> = shared_release_ids.into_iter().map(|(id,)| id).collect();

    // Find ALL artists linked to those releases (includes co-artists on shared releases)
    let all_artist_ids: Vec<(String,)> = if !release_ids.is_empty() {
        sqlx::query_as(
            r#"SELECT DISTINCT lra."artistId" FROM "LocalReleaseArtist" lra
               WHERE lra."localReleaseId" = ANY($1::text[])"#,
        )
        .bind(&release_ids)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let mut nuke_ids: HashSet<String> = target_ids.iter().cloned().collect();
    for (aid,) in &all_artist_ids {
        nuke_ids.insert(aid.clone());
    }

    let nuke_list: Vec<String> = nuke_ids.into_iter().collect();
    let deleted = nuke_list.len() as u64;

    // Collect unique images to delete. Each entry: (local_filename, s3_key).
    // Use slug/id to derive S3 keys — imageUrl may be set even when image (local) is null.
    let mut artist_imgs: Vec<(Option<String>, String)> = Vec::new(); // (local_filename, s3_key)
    let mut release_imgs: HashSet<(Option<String>, String)> = HashSet::new(); // (local_filename, s3_key)

    for (artist_id, slug, image, image_url) in &artists {
        if !nuke_list.contains(artist_id) { continue; }

        // Include artist if it has any image stored (local or S3)
        if image.is_some() || image_url.is_some() {
            artist_imgs.push((image.clone(), format!("artists/{}.jpg", slug)));
        }

        // id, image (local filename), imageUrl
        let imgs: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT DISTINCT lr.id, lr.image, lr."imageUrl" FROM "LocalRelease" lr
               JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
               WHERE lra."artistId" = $1
                 AND (lr.image IS NOT NULL OR lr."imageUrl" IS NOT NULL)"#,
        )
        .bind(artist_id)
        .fetch_all(pool)
        .await?;

        for (release_id, img, img_url) in imgs {
            if img.is_some() || img_url.is_some() {
                release_imgs.insert((img, format!("releases/{}.jpg", release_id)));
            }
        }
    }

    let total_images = artist_imgs.len() + release_imgs.len();
    if total_images > 0 {
        println!("  Deleting {} image(s) ({} artist, {} release)...",
            total_images, artist_imgs.len(), release_imgs.len());
    }

    let mut local_deleted = 0usize;
    let mut s3_deleted = 0usize;

    for (local_filename, s3_key) in &artist_imgs {
        if use_local {
            if let Some(f) = local_filename {
                if fs::remove_file(artist_img_dir.join(f)).is_ok() { local_deleted += 1; }
            }
        }
        if use_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                delete_from_s3(s3, bucket, s3_key).await;
                s3_deleted += 1;
            }
        }
    }

    for (local_filename, s3_key) in &release_imgs {
        if use_local {
            if let Some(f) = local_filename {
                if fs::remove_file(release_img_dir.join(f)).is_ok() { local_deleted += 1; }
            }
        }
        if use_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                delete_from_s3(s3, bucket, s3_key).await;
                s3_deleted += 1;
            }
        }
    }

    if total_images > 0 {
        if use_local && use_s3 {
            println!("  {} Deleted {} local, {} S3", "✓".green(), local_deleted, s3_deleted);
        } else if use_s3 {
            println!("  {} Deleted {} from S3", "✓".green(), s3_deleted);
        } else {
            println!("  {} Deleted {} local", "✓".green(), local_deleted);
        }
    }

    // Delete all linked releases (cascades to tracks, release-artist links)
    if !release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
            .bind(&release_ids)
            .execute(pool)
            .await?;
    }

    // Delete all affected artists
    sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
        .bind(&nuke_list)
        .execute(pool)
        .await?;

    // Clean up any remaining orphaned releases (no artist links at all)
    sqlx::query(
        r#"DELETE FROM "LocalRelease" WHERE id NOT IN (
            SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist"
        )"#,
    )
    .execute(pool)
    .await?;

    Ok(deleted)
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum MatchStatus {
    Complete,
    Incomplete,
    ExtraTracks,
    Missing,
    #[allow(dead_code)]
    Unsyncable,
    Unknown,
}

impl MatchStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Complete => "COMPLETE",
            Self::Incomplete => "INCOMPLETE",
            Self::ExtraTracks => "EXTRA_TRACKS",
            Self::Missing => "MISSING",
            Self::Unsyncable => "UNSYNCABLE",
            Self::Unknown => "UNKNOWN",
        }
    }
}

fn normalize_title(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

async fn check_release_status(
    pool: &PgPool,
    artist_id: &str,
    mb_release_id: &str,
    mb_release_title: &str,
    mb_tracks: &[(String, Option<i32>)],
) -> Result<(MatchStatus, Option<String>, f64), sqlx::Error> {
    // Fetch all local releases for this artist and match by normalized title.
    // Normalization strips punctuation (hyphens, en-dashes, etc.) so
    // "Collateral Damage - Complete War Series" matches "Collateral Damage – Complete War Series".
    let all_local: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT lr.id, lr.title FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
           WHERE lra."artistId" = $1"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;

    let mb_title_norm = normalize_title(mb_release_title);
    let local_release_id = match all_local.iter().find(|(_, t)| normalize_title(t) == mb_title_norm) {
        Some((id, _)) => id.clone(),
        None => {
            return Ok((MatchStatus::Missing, None, 0.0));
        }
    };

    sqlx::query(
        r#"UPDATE "LocalRelease" SET "releaseId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
    )
    .bind(mb_release_id)
    .bind(&local_release_id)
    .execute(pool)
    .await?;

    let local_tracks: Vec<(String,)> = sqlx::query_as(
        r#"SELECT COALESCE(title, '') FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
    )
    .bind(&local_release_id)
    .fetch_all(pool)
    .await?;

    let local_titles: HashSet<String> = local_tracks
        .iter()
        .map(|(t,)| normalize_title(t))
        .collect();

    let mb_titles: HashSet<String> = mb_tracks
        .iter()
        .map(|(t, _)| normalize_title(t))
        .collect();

    // Check if an MB track matches a local track:
    // 1. Exact normalized match, OR
    // 2. Either title contains the other as a substring
    //    (e.g. local "September" matches MB "September (När hjärtat blöder)"
    //     and local "New Model World (Featuring Valopinja)" matches MB "New Model World")
    let missing: Vec<String> = mb_tracks
        .iter()
        .filter(|(t, _)| {
            let norm = normalize_title(t);
            !local_titles.contains(&norm)
                && !local_titles.iter().any(|lt| {
                    !lt.is_empty() && !norm.is_empty()
                        && (norm.contains(lt.as_str()) || lt.contains(norm.as_str()))
                })
        })
        .map(|(t, _)| t.clone())
        .collect();

    let extra: Vec<String> = local_tracks
        .iter()
        .filter(|(t,)| {
            let norm = normalize_title(t);
            !mb_titles.contains(&norm)
                && !mb_titles.iter().any(|mt| {
                    !norm.is_empty() && !mt.is_empty()
                        && (mt.contains(norm.as_str()) || norm.contains(mt.as_str()))
                })
        })
        .map(|(t,)| t.clone())
        .collect();

    let mb_count = mb_tracks.len() as f64;
    let matched_count = mb_count - missing.len() as f64;

    if missing.is_empty() && extra.is_empty() {
        Ok((MatchStatus::Complete, None, 1.0))
    } else if missing.is_empty() && !extra.is_empty() {
        let reason = format!("Found all {} songs locally. Extra tracks: {}", mb_tracks.len(), extra.join(", "));
        Ok((MatchStatus::ExtraTracks, Some(reason), 1.0))
    } else if !missing.is_empty() {
        let reason = format!("Found {}/{} songs locally. Missing {}", matched_count as usize, mb_tracks.len(), missing.join(", "));
        let score = if mb_count > 0.0 { matched_count / mb_count } else { 0.0 };
        Ok((MatchStatus::Incomplete, Some(reason), score))
    } else {
        Ok((MatchStatus::Unknown, None, 0.0))
    }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

async fn save_sync_progress(pool: &PgPool, folder_name: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastSyncedArtist" = $1, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .bind(folder_name)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_sync_progress(pool: &PgPool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT "lastSyncedArtist" FROM "Statistics" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(v,)| v))
}

async fn clear_sync_progress(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastSyncedArtist" = NULL, "updatedAt" = NOW() WHERE id = 'main'"#,
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
             AND lr.id IN (SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1)"#,
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
             SELECT lra."artistId",
                    COUNT(DISTINCT lrt.id)::int as track_count,
                    COALESCE(SUM(DISTINCT lrt."fileSize"), 0) as total_size
             FROM "LocalReleaseTrack" lrt
             JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
             JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
             WHERE lra."artistId" = $1
             GROUP BY lra."artistId"
           ) sub
           WHERE a.id = sub."artistId""#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---------------------------------------------------------------------------
// Artist image download
// ---------------------------------------------------------------------------

async fn download_artist_image(
    client: &Client,
    artist: &MbArtistDetail,
    artist_name: &str,
    artist_slug: &str,
    img_dir: &PathBuf,
    artist_folder: &Path,
    s3_client: &Option<S3Client>,
    config: &Config,
    pool: &PgPool,
    artist_id: &str,
    use_folder_img: bool,
) -> Option<(&'static str, String)> {
    let out_path = img_dir.join(format!("{}.jpg", artist_slug));
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let use_local = config.image_storage == "local" || config.image_storage == "both";

    // Track which source provided the image
    let mut source: &'static str = "local folder";

    // Only try local folder image when explicitly allowed (single-artist folders).
    // Multi-artist folders would give all artists the same image.
    let from_folder = if use_folder_img {
        use_artist_folder_image(artist_folder, &out_path)
    } else {
        false
    };

    if !from_folder {
        // External APIs: MB image → Fanart.tv → Wikidata → Wikipedia → folder fallback
        let mut found: Option<(&'static str, String)> = None;
        let mut wikidata_url: Option<String> = None;
        let mut wikipedia_url: Option<String> = None;

        if let Some(ref relations) = artist.relations {
            for rel in relations {
                if let Some(ref url) = rel.url {
                    match rel.relation_type.as_str() {
                        "image" => {
                            // MB image relation — often a Wikimedia Commons page URL,
                            // not a direct image. Convert to Special:FilePath.
                            found = Some(("MusicBrainz", commons_page_to_file_url(&url.resource)));
                            break;
                        }
                        "wikidata" => { wikidata_url = Some(url.resource.clone()); }
                        "wikipedia" => { wikipedia_url = Some(url.resource.clone()); }
                        _ => {}
                    }
                }
            }
        }

        // Fanart.tv (uses MB ID, no name needed)
        if found.is_none() {
            if let Some(ref api_key) = config.fanart_api_key {
                if let Some(url) = get_fanart_image(client, &artist.id, api_key).await {
                    found = Some(("Fanart.tv", url));
                }
            }
        }

        // Wikidata P18 image claim
        if found.is_none() {
            if let Some(ref url) = wikidata_url {
                if let Some(img) = get_wikidata_image(client, url).await {
                    found = Some(("Wikidata", img));
                }
            }
        }

        // Wikipedia page image
        if found.is_none() {
            if let Some(ref url) = wikipedia_url {
                if let Some(img) = get_wikipedia_image(client, url).await {
                    found = Some(("Wikipedia", img));
                }
            }
        }

        match found {
            Some((src, url)) => {
                source = src;
                if !download_and_resize(client, &url, &out_path).await {
                    return None;
                }
            }
            None => {
                // Last resort: use folder image if artist name exactly matches folder name
                let folder_name = artist_folder.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if folder_name.eq_ignore_ascii_case(artist_name) {
                    if !use_artist_folder_image(artist_folder, &out_path) {
                        return None;
                    }
                    source = "local folder";
                } else {
                    return None;
                }
            }
        }
    }

    let mut stored = false;

    if use_s3 {
        if let (Some(ref s3), Some(ref bucket), Some(ref public_url)) =
            (s3_client, &config.s3_bucket, &config.s3_public_url)
        {
            let s3_key = format!("artists/{}.jpg", artist_slug);
            if upload_to_s3(s3, bucket, &s3_key, &out_path).await.is_ok() {
                let image_url = format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
                sqlx::query(
                    r#"UPDATE "Artist" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                )
                .bind(&image_url)
                .bind(artist_id)
                .execute(pool)
                .await
                .ok();
                stored = true;
            }
        }
    }

    if use_local {
        let local_filename = format!("{}.jpg", artist_slug);
        sqlx::query(r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#)
            .bind(&local_filename)
            .bind(artist_id)
            .execute(pool)
            .await
            .ok();
        stored = true;
    }

    if !use_local && use_s3 {
        fs::remove_file(&out_path).ok();
    }

    if stored {
        Some((source, format!("/img/artists/{}.jpg", artist_slug)))
    } else {
        None
    }
}

/// Convert a Wikimedia Commons page URL to a direct file URL.
/// e.g. "https://commons.wikimedia.org/wiki/File:Foo.png" → "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.png?width=500"
/// Non-Commons URLs are returned as-is.
fn commons_page_to_file_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://commons.wikimedia.org/wiki/File:") {
        let encoded = urlencoding::encode(rest);
        format!("https://commons.wikimedia.org/wiki/Special:FilePath/{}?width=500", encoded)
    } else {
        url.to_string()
    }
}

/// Fetch artist image from Wikidata P18 claim.
async fn get_wikidata_image(client: &Client, wikidata_url: &str) -> Option<String> {
    let wikidata_id = wikidata_url.rsplit('/').next()?;
    let api_url = format!(
        "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&props=claims&format=json",
        wikidata_id
    );

    let resp = client
        .get(&api_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .ok()?;

    let body: JsonValue = resp.json().await.ok()?;

    let filename = body
        .get("entities")?
        .get(wikidata_id)?
        .get("claims")?
        .get("P18")?
        .get(0)?
        .get("mainsnak")?
        .get("datavalue")?
        .get("value")?
        .as_str()?;

    let filename_encoded = urlencoding::encode(filename);
    Some(format!(
        "https://commons.wikimedia.org/wiki/Special:FilePath/{}?width=500",
        filename_encoded
    ))
}

/// Fetch artist image from Wikipedia page image API.
async fn get_wikipedia_image(client: &Client, wiki_url: &str) -> Option<String> {
    let title = wiki_url.rsplit('/').next()?;
    let encoded_title = urlencoding::encode(title);
    let api_url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&titles={}&prop=pageimages&format=json&pithumbsize=500",
        encoded_title
    );

    let resp = client
        .get(&api_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .ok()?;

    let body: JsonValue = resp.json().await.ok()?;
    let pages = body.get("query")?.get("pages")?;

    if let JsonValue::Object(map) = pages {
        for (_, page) in map {
            if let Some(thumb) = page.get("thumbnail") {
                return thumb.get("source")?.as_str().map(|s| s.to_string());
            }
        }
    }

    None
}

/// Fetch artist image from Fanart.tv using MB artist ID.
async fn get_fanart_image(client: &Client, mb_id: &str, api_key: &str) -> Option<String> {
    let url = format!(
        "https://webservice.fanart.tv/v3/music/{}?api_key={}",
        mb_id, api_key
    );

    let resp = client.get(&url).header("User-Agent", USER_AGENT).send().await.ok()?;
    if resp.status() != 200 { return None; }

    let data: JsonValue = resp.json().await.ok()?;

    // Try artistthumb first, then artistbackground
    for key in &["artistthumb", "artistbackground"] {
        if let Some(arr) = data.get(key).and_then(|v| v.as_array()) {
            if let Some(first) = arr.first() {
                if let Some(url) = first.get("url").and_then(|u| u.as_str()) {
                    return Some(url.to_string());
                }
            }
        }
    }

    None
}

async fn download_and_resize(client: &Client, url: &str, out_path: &PathBuf) -> bool {
    let resp = match client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return false,
    };

    if resp.status() != 200 {
        return false;
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return false,
    };

    match image::load_from_memory(&bytes) {
        Ok(img) => {
            let resized =
                img.resize_to_fill(200, 200, image::imageops::FilterType::Triangle);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            resized.save(out_path).is_ok()
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Statistics (merged from both scripts)
// ---------------------------------------------------------------------------

async fn update_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();

    sqlx::query(
        r#"INSERT INTO "Statistics" (
             id, artists, tracks, releases, genres,
             "releasesWithCoverArt", playtime,
             "artistsSyncedWithMusicbrainz", "releasesSyncedWithMusicbrainz",
             "artistsWithCoverArt",
             "lastScanEndedAt", "updatedAt"
           )
           SELECT 'main',
             (SELECT COUNT(*)::int FROM "Artist"),
             (SELECT COUNT(*)::int FROM "LocalReleaseTrack"),
             (SELECT COUNT(*)::int FROM "LocalRelease"),
             (SELECT COUNT(*)::int FROM "Genre"),
             (SELECT COUNT(*)::int FROM "LocalRelease" WHERE image IS NOT NULL),
             COALESCE((SELECT SUM(duration)::bigint FROM "LocalReleaseTrack"), 0),
             (SELECT COUNT(*)::int FROM "Artist" WHERE "musicbrainzId" IS NOT NULL),
             (SELECT COUNT(*)::int FROM "MusicBrainzRelease"),
             (SELECT COUNT(*)::int FROM "Artist" WHERE image IS NOT NULL),
             $1, $1
           ON CONFLICT (id) DO UPDATE SET
             artists = EXCLUDED.artists,
             tracks = EXCLUDED.tracks,
             releases = EXCLUDED.releases,
             genres = EXCLUDED.genres,
             "releasesWithCoverArt" = EXCLUDED."releasesWithCoverArt",
             playtime = EXCLUDED.playtime,
             "artistsSyncedWithMusicbrainz" = EXCLUDED."artistsSyncedWithMusicbrainz",
             "releasesSyncedWithMusicbrainz" = EXCLUDED."releasesSyncedWithMusicbrainz",
             "artistsWithCoverArt" = EXCLUDED."artistsWithCoverArt",
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
    let music_dir = if args.test {
        let test_dir = PathBuf::from(&config.project_root).join("web/dump/test-artists");
        if !test_dir.exists() {
            eprintln!("Test directory not found: {}", test_dir.display());
            eprintln!("Run ./symlink-test-artists first to create it.");
            std::process::exit(1);
        }
        test_dir.to_string_lossy().trim_end_matches('/').to_string()
    } else {
        config.music_dir.trim_end_matches('/').to_string()
    };

    // Configure thread pool
    if args.threads > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(args.threads)
            .build_global()
            .ok();
    }
    let thread_count = rayon::current_num_threads();

    println!("{}", "DMP Sync".bright_cyan().bold());
    println!("{}", "========".bright_black());
    println!("Music dir     : {}{}", music_dir.bright_white(),
        if args.test { " (test mode)".yellow().to_string() } else { String::new() });
    println!("Image storage : {}", config.image_storage.bright_white());
    if !args.only.is_empty() {
        println!("Filter        : only '{}'", args.only.bright_white());
    } else if !args.from.is_empty() || !args.to.is_empty() {
        let from_str = if args.from.is_empty() { "A".to_string() } else { args.from.to_uppercase() };
        let to_str = if args.to.is_empty() { "Z".to_string() } else { args.to.to_uppercase() };
        println!("Filter        : {} to {}", from_str.bright_white(), to_str.bright_white());
    }
    if args.limit > 0 {
        println!("Limit         : {} folders", args.limit.to_string().bright_white());
    }
    if args.resume {
        println!("Mode          : {}", "resume from checkpoint".yellow());
    }
    if args.overwrite {
        println!("Mode          : {}", "overwrite (nuke + re-sync)".red());
    }
    if args.skip_images {
        println!("Images        : {}", "skipped".yellow());
    }
    println!("Threads       : {}", thread_count.to_string().bright_white());
    println!("Started at    : {}", Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string().bright_white());
    println!();

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    let http_client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    let mut limiter = RateLimiter::new();
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

    // --- S3 client (needed for nuke image cleanup and later for image uploads) ---
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let s3_client = if use_s3 { create_s3_client(&config).await } else { None };

    // --- Overwrite: nuke matching data first ---
    if args.overwrite {
        println!("Nuking matching data...");
        match nuke_artists(&pool, &from_filter, &to_filter, &only_filter, &config.project_root, &s3_client, &config).await {
            Ok(count) => println!("  Deleted {} artists and all related data", count.to_string().bright_white()),
            Err(e) => {
                eprintln!("  Error during nuke: {}", e);
                std::process::exit(1);
            }
        }
        clear_sync_progress(&pool).await.ok();
        println!();
    }

    // --- Resume: load progress ---
    let resume_folder = if args.resume {
        match load_sync_progress(&pool).await {
            Ok(Some(folder)) => {
                println!("Resuming after '{}'", folder.bright_white());
                Some(folder)
            }
            _ => {
                println!("No progress found, starting from scratch");
                None
            }
        }
    } else {
        clear_sync_progress(&pool).await.ok();
        None
    };

    // --- Setup: error log + caches ---
    let error_log = Mutex::new(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("errors.log")
            .expect("Cannot open errors.log"),
    );

    println!("Loading caches...");

    // Track count for display (lightweight count instead of loading all rows)
    let existing_track_count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM "LocalReleaseTrack""#,
    )
    .fetch_one(&pool)
    .await
    .unwrap_or((0,));
    eprintln!("  {} existing tracks", existing_track_count.0.to_string().bright_white());

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
        eprintln!("  {} artists", artist_cache.len().to_string().bright_white());
    }

    let mut release_cache: HashMap<(String, String), String> = HashMap::new();
    {
        let rows: Vec<(Option<String>, String, String)> = sqlx::query_as(
            r#"SELECT "folderPath", title, id FROM "LocalRelease""#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        for (folder_path, title, id) in rows {
            let fp = folder_path.unwrap_or_default();
            release_cache.insert((fp, title), id);
        }
        eprintln!("  {} releases", release_cache.len().to_string().bright_white());
    }

    let mut genre_cache: HashMap<String, String> = HashMap::new();
    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    println!();

    // --- List artist folders ---
    let extensions: &[&str] = &["mp3", "m4a", "opus", "aac", "ogg", "flac"];

    let mut artist_folders: Vec<String> = fs::read_dir(&music_dir)
        .expect("Cannot read music directory")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map_or(false, |ft| ft.is_dir() || ft.is_symlink()))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|f| matches_filter(f, &from_filter, &to_filter, &only_filter))
        .collect();
    artist_folders.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    if let Some(ref resume_f) = resume_folder {
        let resume_lower = resume_f.to_lowercase();
        artist_folders.retain(|f| f.to_lowercase() > resume_lower);
    }

    if args.limit > 0 && artist_folders.len() > args.limit {
        artist_folders.truncate(args.limit);
    }

    let total_folders = artist_folders.len();
    if total_folders == 0 {
        println!("No matching folders found. Nothing to do.");
        return;
    }

    // --- Pre-init image config ---
    let use_local = config.image_storage == "local" || config.image_storage == "both";
    // s3_client already created above (needed for nuke)
    let release_img_dir = PathBuf::from(&config.project_root).join("web/public/img/releases");
    let artist_img_dir = PathBuf::from(&config.project_root).join("web/public/img/artists");
    fs::create_dir_all(&release_img_dir).ok();
    fs::create_dir_all(&artist_img_dir).ok();

    // --- Counters ---
    let mut new_total = 0u64;
    let mut updated_total = 0u64;
    let mut skipped_total = 0u64;
    let mut db_error_total = 0u64;
    let mut scan_error_total = 0u64;
    let mut total_files = 0u64;
    let mut artists_with_errors: Vec<(String, u64)> = Vec::new();
    let music_dir_clone = music_dir.clone();

    let mut synced = 0u32;
    let mut failed_sync = 0u32;
    let mut partial_sync = 0u32;
    let mut synced_mb_ids: HashMap<String, String> = HashMap::new();
    let mut failed_artists: Vec<(String, String)> = Vec::new();

    // Helper closure: overwrite a single status line beneath the folder header
    let print_substep = |step: &str| {
        eprint!("\r\x1b[K    {}", step);
    };

    println!("Processing {} artist folders...", total_folders.to_string().bright_white());
    println!();

    for (folder_idx, folder_name) in artist_folders.iter().enumerate() {
        // Print permanent folder header
        println!(
            "  {} {} [{}/{}]",
            "→".bright_black(),
            folder_name.bright_cyan(),
            folder_idx + 1,
            total_folders,
        );
        print_substep("scanning files...");

        // =====================================================================
        // INDEX PHASE
        // =====================================================================

        // Load existing tracks for this folder only (not entire DB)
        let folder_prefix = format!("{}/%", folder_name);
        let existing_tracks: HashMap<String, (i64, NaiveDateTime, String)> = if !args.overwrite {
            let rows: Vec<(String, i64, Option<NaiveDateTime>, Option<String>)> = sqlx::query_as(
                r#"SELECT "filePath", "fileSize", mtime, "contentHash" FROM "LocalReleaseTrack"
                   WHERE "filePath" LIKE $1"#,
            )
            .bind(&folder_prefix)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            rows.into_iter()
                .map(|(path, size, mtime, hash)| {
                    (path, (size, mtime.unwrap_or_else(|| Utc::now().naive_utc()), hash.unwrap_or_default()))
                })
                .collect()
        } else {
            HashMap::new() // --overwrite: no change detection needed
        };

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
            .collect();

        let folder_file_count = paths.len();
        if folder_file_count == 0 {
            eprint!("\r\x1b[K");
            println!("    {} 0 files", "→".bright_black());
            save_sync_progress(&pool, folder_name).await.ok();
            continue;
        }
        total_files += folder_file_count as u64;

        // --- Step 2: Extract metadata in parallel ---
        eprint!("\r\x1b[K");
        println!("    Extracting metadata ({} files)...", folder_file_count);
        let scan_errors = AtomicU64::new(0);

        let extracted: Vec<TrackMeta> = paths
            .par_iter()
            .filter_map(|p| {
                match extract_metadata(p, &music_dir_clone) {
                    Ok(meta) => {
                        if meta.artist.is_none() || meta.artist.as_deref() == Some("") {
                            scan_errors.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut f) = error_log.lock() {
                                writeln!(f, "[{}][SYNC] Missing artist tag: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), p.display()).ok();
                            }
                            return None;
                        }
                        Some(meta)
                    }
                    Err(reason) => {
                        scan_errors.fetch_add(1, Ordering::Relaxed);
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[{}][SYNC] Failed to read: {} ({})", Utc::now().format("%Y-%m-%d %H:%M:%S"), p.display(), reason).ok();
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
            eprint!("\r\x1b[K");
            println!("    {} {} files, all failed to parse", "→".bright_black(), folder_file_count);
            save_sync_progress(&pool, folder_name).await.ok();
            continue;
        }

        // --- Step 3: Change detection + batch upsert ---
        print_substep("upserting to database...");
        let mut folder_new = 0u64;
        let mut folder_updated = 0u64;
        let mut folder_skipped = 0u64;
        let mut group_errors = 0u64;
        let mut batch_tracks: Vec<(&TrackMeta, String)> = Vec::new();
        let mut pending_links: Vec<(String, String, String)> = Vec::new();
        let mut mtime_updates: Vec<(NaiveDateTime, String)> = Vec::new();
        let mut folder_artist_ids: HashSet<String> = HashSet::new();
        // Collect embedded MB IDs per artist: artist_db_id -> (mb_artist_id, mb_album_id)
        let mut folder_mb_hints: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
        let mut releases_needing_art: HashMap<String, PathBuf> = HashMap::new();
        // All releases in this folder: release_id -> relative folder path
        let mut folder_releases: HashMap<String, String> = HashMap::new();
        // Collect (release_id, artist_id) pairs for batch LocalReleaseArtist insert
        let mut pending_release_artist_links: HashSet<(String, String)> = HashSet::new();
        // Track releases that already have cover art (to avoid redundant work across steps)
        let mut releases_with_art: HashSet<String> = HashSet::new();

        for track in &extracted {
            // Change detection — skip unchanged tracks (unless --overwrite)
            if !args.overwrite {
                if let Some((existing_size, existing_mtime, existing_hash)) = existing_tracks.get(&track.file_path) {
                    if *existing_size == track.file_size
                        && (*existing_mtime - track.mtime).num_seconds().abs() < 2
                    {
                        skipped_total += 1;
                        folder_skipped += 1;
                        continue;
                    }
                    if *existing_hash == track.content_hash {
                        mtime_updates.push((track.mtime, track.file_path.clone()));
                        skipped_total += 1;
                        folder_skipped += 1;
                        continue;
                    }
                    updated_total += 1;
                    folder_updated += 1;
                } else {
                    new_total += 1;
                    folder_new += 1;
                }
            } else {
                new_total += 1;
                folder_new += 1;
            }

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

            let album_name = track.album.as_deref().unwrap_or("Unknown Album");

            let folder_path_str = {
                let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                if parts.len() > 1 { parts[1].to_string() } else { String::new() }
            };

            // Create release keyed by (title, folderPath) — no artist dependency
            let release_id = match ensure_local_release_cached(
                &pool, album_name, track.year,
                &folder_path_str, &mut release_cache,
            ).await {
                Ok(id) => id,
                Err(e) => {
                    group_errors += 1;
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][SYNC] DB error (release '{}') {}: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), album_name, track.file_path, e).ok();
                    }
                    continue;
                }
            };

            let fp = track.file_path.clone();

            // Track all releases in this folder for cover art fallback
            folder_releases.entry(release_id.clone()).or_insert_with(|| folder_path_str.clone());

            // Link release to ALL album artists (many-to-many via LocalReleaseArtist)
            if main_album_artists.is_empty() {
                // Fallback: use first track artist
                let fallback_name = main_track_artists.first()
                    .map(|s| s.as_str())
                    .unwrap_or("Unknown Artist");
                if let Ok(aid) = ensure_artist_cached(&pool, fallback_name, &mut artist_cache).await {
                    if !aid.is_empty() {
                        pending_release_artist_links.insert((release_id.clone(), aid.clone()));
                        folder_artist_ids.insert(aid.clone());
                        pending_links.push((fp.clone(), aid, "ALBUM_ARTIST".to_string()));
                    }
                }
            } else {
                for aa_name in &main_album_artists {
                    if let Ok(aa_id) = ensure_artist_cached(&pool, aa_name, &mut artist_cache).await {
                        if !aa_id.is_empty() {
                            pending_release_artist_links.insert((release_id.clone(), aa_id.clone()));
                            folder_artist_ids.insert(aa_id.clone());
                            pending_links.push((fp.clone(), aa_id.clone(), "ALBUM_ARTIST".to_string()));
                        }
                    }
                }
            }

            // TrackArtist links for track-level artists
            if main_track_artists.is_empty() {
                let fallback_name = main_album_artists.first()
                    .map(|s| s.as_str())
                    .unwrap_or("Unknown Artist");
                if let Ok(aid) = ensure_artist_cached(&pool, fallback_name, &mut artist_cache).await {
                    if !aid.is_empty() {
                        pending_links.push((fp.clone(), aid, "PRIMARY".to_string()));
                    }
                }
            } else {
                for ta_name in &main_track_artists {
                    if let Ok(ta_id) = ensure_artist_cached(&pool, ta_name, &mut artist_cache).await {
                        if !ta_id.is_empty() {
                            pending_links.push((fp.clone(), ta_id, "PRIMARY".to_string()));
                        }
                    }
                }
            }

            let all_featured: Vec<String> = feat_album_artists.iter()
                .chain(feat_track_artists.iter())
                .cloned()
                .collect::<HashSet<String>>()
                .into_iter()
                .collect();
            for feat_name in &all_featured {
                if let Ok(feat_id) = ensure_artist_cached(&pool, feat_name, &mut artist_cache).await {
                    if !feat_id.is_empty() {
                        pending_links.push((fp.clone(), feat_id, "FEATURED".to_string()));
                    }
                }
            }

            if track.has_picture && !args.skip_images {
                let out_path = release_img_dir.join(format!("{}.jpg", release_id));
                if !out_path.exists() {
                    releases_needing_art
                        .entry(release_id.clone())
                        .or_insert_with(|| PathBuf::from(&track.file_path));
                }
            }

            // Collect embedded MB IDs for the sync phase
            // mb_album_artist_id → maps to the first album artist
            // mb_artist_id → maps to track-level artists (may differ)
            if track.mb_album_artist_id.is_some() || track.mb_album_id.is_some() {
                // Associate with the first album artist (canonical owner)
                let target_artist = if !main_album_artists.is_empty() {
                    artist_cache.get(&make_slug(main_album_artists.first().unwrap())).cloned()
                } else {
                    None
                };
                if let Some(ref aid) = target_artist {
                    let entry = folder_mb_hints.entry(aid.clone()).or_insert((None, None));
                    if entry.0.is_none() {
                        entry.0 = track.mb_album_artist_id.clone();
                    }
                    if entry.1.is_none() {
                        entry.1 = track.mb_album_id.clone();
                    }
                }
            }

            batch_tracks.push((track, release_id));
        }

        db_error_total += group_errors;

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
                            writeln!(f, "[{}][SYNC] DB error (batch track_artist) folder '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), folder_name, e).ok();
                        }
                    }
                }
                Err(e) => {
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][SYNC] DB error (batch upsert) folder '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), folder_name, e).ok();
                    }
                    db_error_total += batch_tracks.len() as u64;
                }
            }
        }

        if group_errors > 0 {
            if let Some(entry) = artists_with_errors.iter_mut().rev().find(|(name, _)| name == folder_name) {
                entry.1 += group_errors;
            } else {
                artists_with_errors.push((folder_name.clone(), group_errors));
            }
        }

        // Print index summary for this folder (clear ephemeral substep first)
        eprint!("\r\x1b[K");
        {
            let mut parts: Vec<String> = Vec::new();
            parts.push(format!("{} files", folder_file_count));
            if folder_new > 0 { parts.push(format!("{} new", folder_new)); }
            if folder_updated > 0 { parts.push(format!("{} updated", folder_updated)); }
            if folder_skipped > 0 { parts.push(format!("{} skipped", folder_skipped)); }
            if group_errors > 0 { parts.push(format!("{} errors", group_errors)); }
            println!("    {} {}", "→".bright_black(), parts.join(" | "));
        }

        // --- Step 3b: Batch insert LocalReleaseArtist links ---
        if !pending_release_artist_links.is_empty() {
            let links: Vec<(String, String)> = pending_release_artist_links.into_iter().collect();
            batch_ensure_local_release_artists(&pool, &links).await.ok();
        }

        // --- Step 4: Cover art extraction ---
        if !args.skip_images && !releases_needing_art.is_empty() {
            println!("    Extracting artwork ({} releases)...", releases_needing_art.len());
            let art_entries: Vec<(&String, &PathBuf)> = releases_needing_art.iter().collect();
            let extracted_covers: Vec<(String, PathBuf, bool)> = art_entries
                .par_iter()
                .map(|(release_id, source_path)| {
                    let out_path = release_img_dir.join(format!("{}.jpg", release_id));
                    if out_path.exists() {
                        return ((*release_id).clone(), out_path, false);
                    }
                    let success = extract_cover_art(source_path, &out_path);
                    ((*release_id).clone(), out_path, success)
                })
                .collect();

            // Upload to S3 concurrently (up to 8 at a time)
            if use_s3 {
                if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                    (&s3_client, &config.s3_bucket, &config.s3_public_url)
                {
                    use futures::stream::{FuturesUnordered, StreamExt};
                    let mut uploads = FuturesUnordered::new();
                    for (release_id, out_path, newly_extracted) in &extracted_covers {
                        if !newly_extracted { continue; }
                        let client = client.clone();
                        let bucket = bucket.clone();
                        let public_url = public_url.clone();
                        let pool = pool.clone();
                        let release_id = release_id.clone();
                        let out_path = out_path.clone();
                        uploads.push(async move {
                            let ok = upload_release_image_to_s3(
                                &client, &bucket, &public_url, &pool, &release_id, &out_path,
                            ).await;
                            (release_id, ok)
                        });
                        // Limit concurrency: drain when we hit 8 in-flight
                        if uploads.len() >= 8 {
                            if let Some((rid, _)) = uploads.next().await {
                                releases_with_art.insert(rid);
                            }
                        }
                    }
                    // Drain remaining
                    while let Some((rid, _)) = uploads.next().await {
                        releases_with_art.insert(rid);
                    }
                }
            }

            // Update local DB fields and track art status for non-S3 paths
            for (release_id, _out_path, newly_extracted) in &extracted_covers {
                if !newly_extracted { continue; }
                if use_local {
                    let filename = format!("{}.jpg", release_id);
                    sqlx::query(
                        r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&filename)
                    .bind(release_id)
                    .execute(&pool)
                    .await
                    .ok();
                }
                releases_with_art.insert(release_id.clone());
            }
        }

        // --- Step 4b: Folder image fallback (cover.jpg / folder.jpg) ---
        if !args.skip_images {
            // Find releases in this folder that still have no cover art
            let releases_without_art: Vec<(String, String)> = folder_releases.iter()
                .filter(|(rid, _)| !releases_with_art.contains(*rid))
                .map(|(rid, fp)| (rid.clone(), fp.clone()))
                .collect();

            if !releases_without_art.is_empty() {
                let mut folder_art_found = 0;
                for (release_id, rel_folder_path) in &releases_without_art {
                    let abs_folder = PathBuf::from(&music_dir).join(rel_folder_path);
                    let out_path = release_img_dir.join(format!("{}.jpg", release_id));

                    if let Some(_source_name) = use_folder_image(&abs_folder, &out_path) {
                        folder_art_found += 1;

                        if use_s3 {
                            if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                                (&s3_client, &config.s3_bucket, &config.s3_public_url)
                            {
                                let s3_key = format!("releases/{}.jpg", release_id);
                                match upload_to_s3(client, bucket, &s3_key, &out_path).await {
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
                                            writeln!(f, "[{}][SYNC] S3 upload failed for release {}: {:?}",
                                                Utc::now().format("%Y-%m-%d %H:%M:%S"), release_id, e).ok();
                                        }
                                    }
                                }
                            }
                        }

                        if use_local {
                            let filename = format!("{}.jpg", release_id);
                            sqlx::query(
                                r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                            )
                            .bind(&filename)
                            .bind(release_id)
                            .execute(&pool)
                            .await
                            .ok();
                        }

                        releases_with_art.insert(release_id.clone());
                    }
                }
                if folder_art_found > 0 {
                    println!("    {} Found {} cover{} from folder images",
                        "→".bright_black(),
                        folder_art_found.to_string().bright_white(),
                        if folder_art_found == 1 { "" } else { "s" });
                }
            }
        }

        // --- Backfill folder context from DB for skipped tracks ---
        // When tracks are skipped (unchanged), the artist/release collection code
        // doesn't run. Query the DB for all releases and artists in this folder
        // so the sync phase has the full picture.
        {
            // Backfill folder_releases: all releases whose tracks are in this folder
            let folder_prefix = format!("{}/%", folder_name);
            let db_releases: Vec<(String, String)> = sqlx::query_as(
                r#"SELECT DISTINCT lr.id, lr."folderPath"
                   FROM "LocalRelease" lr
                   WHERE lr."folderPath" LIKE $1"#,
            )
            .bind(&folder_prefix)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            for (rid, fp) in db_releases {
                folder_releases.entry(rid).or_insert(fp);
            }

            // Backfill folder_artist_ids from album-level artist links only.
            // Track-level artists (featured artists, compound names) are NOT included —
            // they don't need full MB sync. Compound names are resolved via extra_artists_to_sync.
            let folder_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
            if !folder_release_ids.is_empty() {
                let album_artists: Vec<(String,)> = sqlx::query_as(
                    r#"SELECT DISTINCT lra."artistId"
                       FROM "LocalReleaseArtist" lra
                       WHERE lra."localReleaseId" = ANY($1::text[])"#,
                )
                .bind(&folder_release_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
                for (aid,) in album_artists {
                    folder_artist_ids.insert(aid);
                }
            }
        }

        // --- Step 5: Update totals ---
        for aid in &folder_artist_ids {
            update_release_totals_for_artist(&pool, aid).await.ok();
            update_artist_totals_for_artist(&pool, aid).await.ok();
        }

        // =====================================================================
        // SYNC PHASE — per artist ID touched in this folder
        // =====================================================================

        let mut pending_extra_artists: Vec<(String, MbArtistMatch)> = Vec::new();
        // Single-artist folder: use folder image. Multi-artist: external only.
        let is_single_artist_folder = folder_artist_ids.len() == 1;

        for artist_id in &folder_artist_ids {
            // Look up artist info from DB
            let artist_info: Option<(String, String, Option<String>)> = sqlx::query_as(
                r#"SELECT name, slug, "musicbrainzId" FROM "Artist" WHERE id = $1"#,
            )
            .bind(artist_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

            let (artist_name, artist_slug, existing_mb_id) = match artist_info {
                Some(info) => info,
                None => continue,
            };

            // Skip "Various Artists"
            if is_various_artists(&artist_name) {
                continue;
            }

            // If already synced (has musicbrainzId), still re-match local releases
            // without calling the MB API — ensures artists indexed after a prior
            // sync (e.g. found as extra from a compound name) get correct statuses.
            if !args.overwrite && existing_mb_id.is_some() {
                let mid = existing_mb_id.as_ref().unwrap().clone();
                if !synced_mb_ids.contains_key(&mid) {
                    synced_mb_ids.insert(mid, artist_id.to_string());
                }
                // Fall through — the duplicate-check path will re-match local releases
            }

            // Print sync header — show artist name only when multiple artists in folder
            if folder_artist_ids.len() > 1 {
                println!(
                    "    {} {}",
                    "Syncing:".white(),
                    artist_name.bright_cyan().bold()
                );
            }

            // 1. Find artist on MusicBrainz
            println!("    {} Searching MusicBrainz...", "→".bright_black());
            let mut extra_artists_to_sync: Vec<(String, MbArtistMatch)> = Vec::new();
            let mb_id = if let Some(ref mid) = existing_mb_id {
                println!("      {} Using existing MB ID: {}", "✓".green(), mid.bright_black());
                mid.clone()
            } else {
                let hints = folder_mb_hints.get(artist_id);
                let hint_artist = hints.and_then(|(a, _)| a.as_deref());
                let hint_album = hints.and_then(|(_, b)| b.as_deref());
                match find_mb_match_with_fallback(&http_client, &pool, artist_id, &artist_name, hint_artist, hint_album, &mut limiter).await {
                    Ok((Some(m), additional)) => {
                        // Detect compound names like "10cc & Godley & Creme" → "10cc"
                        // or "…and Oceans vs. Bloodthorn" → "…and Oceans".
                        // Split into individual artists, link the shared release to
                        // each one, and fetch their details. No full catalogue —
                        // that happens when each artist's own folder is processed.
                        if is_likely_compound_of(&artist_name, &m.name) {
                            println!("    {} Compound name — splitting into components",
                                "↷".yellow());
                            // Queue ALL components (primary + credited) as extra artists
                            println!("      {} {} ({})",
                                "✓".green(), m.name.bright_white(), m.id.bright_black());
                            pending_extra_artists.push((m.name.clone(), m));
                            for (ref name, ref am) in &additional {
                                println!("      {} {} ({})",
                                    "✓".green(), name.bright_white(), am.id.bright_black());
                            }
                            pending_extra_artists.extend(additional);
                            // Remove the compound artist's links so the individual
                            // components take over and the compound gets cleaned up
                            sqlx::query(r#"DELETE FROM "LocalReleaseArtist" WHERE "artistId" = $1"#)
                                .bind(artist_id).execute(&pool).await.ok();
                            sqlx::query(r#"DELETE FROM "TrackArtist" WHERE "artistId" = $1"#)
                                .bind(artist_id).execute(&pool).await.ok();
                            sqlx::query(r#"UPDATE "Artist" SET "totalTracks" = 0, "totalPlayCount" = 0, "totalFileSize" = 0 WHERE id = $1"#)
                                .bind(artist_id).execute(&pool).await.ok();
                            continue;
                        }

                        sqlx::query(
                            r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&m.id)
                        .bind(artist_id)
                        .execute(&pool)
                        .await
                        .ok();
                        extra_artists_to_sync = additional;
                        m.id
                    }
                    Ok((None, _)) => {
                        println!("      {} No MusicBrainz match", "⚠".yellow());
                        sqlx::query(
                            r#"UPDATE "Artist" SET "lastSyncedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1"#,
                        )
                        .bind(artist_id)
                        .execute(&pool)
                        .await
                        .ok();
                        continue;
                    }
                    Err(e) => {
                        println!("      {} Error: {}", "✗".red(), e.bright_red());
                        failed_artists.push((artist_name.clone(), format!("Search error: {}", e)));
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[{}][SYNC] Search error for artist '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), artist_name, e).ok();
                        }
                        failed_sync += 1;
                        continue;
                    }
                }
            };

            // Re-match local releases using existing DB data (no MB API calls needed)
            if let Some(primary_artist_id) = synced_mb_ids.get(&mb_id).cloned() {
                let same_artist = primary_artist_id == *artist_id;
                if same_artist {
                    println!("    {} Already synced — re-matching local releases", "↷".yellow());
                } else {
                    let primary_name: Option<(String,)> = sqlx::query_as(
                        r#"SELECT name FROM "Artist" WHERE id = $1"#,
                    ).bind(&primary_artist_id).fetch_optional(&pool).await.unwrap_or(None);
                    let pname = primary_name.map(|(n,)| n).unwrap_or_else(|| primary_artist_id.clone());
                    println!("    {} Same MB ID as '{}' — merging", "↷".yellow(), pname.bright_white());
                }

                // If this resolved to the same MB ID as another artist in this folder,
                // it's a duplicate — could be a compound name, mistagged track, or
                // name variant. Always merge into the primary and clean up.
                if !same_artist {
                    // Move releases to the primary artist
                    sqlx::query(
                        r#"UPDATE "LocalReleaseArtist" SET "artistId" = $1
                           WHERE "artistId" = $2 AND "localReleaseId" NOT IN (
                               SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1
                           )"#,
                    )
                    .bind(&primary_artist_id)
                    .bind(artist_id)
                    .execute(&pool)
                    .await
                    .ok();
                    // Clean up the duplicate: remove all links then delete the artist
                    sqlx::query(r#"DELETE FROM "LocalReleaseArtist" WHERE "artistId" = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "TrackArtist" WHERE "artistId" = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "ArtistUrl" WHERE "artistId" = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "_ArtistGenres" WHERE "A" = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    // Clean up orphaned releases (no artist links remaining)
                    sqlx::query(r#"DELETE FROM "MusicBrainzReleaseTrack" WHERE "releaseId" IN (SELECT id FROM "MusicBrainzRelease" WHERE id NOT IN (SELECT "releaseId" FROM "MusicBrainzReleaseArtist"))"#)
                        .execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE id NOT IN (SELECT "releaseId" FROM "MusicBrainzReleaseArtist")"#)
                        .execute(&pool).await.ok();
                    sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#)
                        .bind(artist_id).execute(&pool).await.ok();
                    update_release_totals_for_artist(&pool, &primary_artist_id).await.ok();
                    update_artist_totals_for_artist(&pool, &primary_artist_id).await.ok();
                    println!("    {} Releases moved, duplicate deleted", "✓".green());
                    if !extra_artists_to_sync.is_empty() {
                        pending_extra_artists.extend(extra_artists_to_sync);
                    }
                    continue;
                }

                sqlx::query(
                    r#"UPDATE "Artist" SET "musicbrainzId" = $1, "lastSyncedAt" = NOW(), "updatedAt" = NOW() WHERE id = $2"#,
                )
                .bind(&mb_id)
                .bind(artist_id)
                .execute(&pool)
                .await
                .ok();

                // Batch fetch all MB releases + their tracks in 2 queries (not N+1)
                let mb_releases: Vec<(String, String)> = sqlx::query_as(
                    r#"SELECT mbr.id, mbr.title FROM "MusicBrainzRelease" mbr
                       JOIN "MusicBrainzReleaseArtist" mbra ON mbr.id = mbra."releaseId"
                       WHERE mbra."artistId" = $1"#,
                )
                .bind(&primary_artist_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                let mb_release_ids: Vec<String> = mb_releases.iter().map(|(id, _)| id.clone()).collect();
                let all_mb_tracks: Vec<(String, String, Option<i32>)> = if !mb_release_ids.is_empty() {
                    sqlx::query_as(
                        r#"SELECT "releaseId", title, position FROM "MusicBrainzReleaseTrack"
                           WHERE "releaseId" = ANY($1::text[])
                           ORDER BY "releaseId", position"#,
                    )
                    .bind(&mb_release_ids)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default()
                } else {
                    Vec::new()
                };

                // Group tracks by release ID
                let mut tracks_by_release: HashMap<String, Vec<(String, Option<i32>)>> = HashMap::new();
                for (rel_id, title, pos) in all_mb_tracks {
                    tracks_by_release.entry(rel_id).or_default().push((title, pos));
                }

                let mut linked = 0u32;
                let mut status_updates: Vec<(String, String, Option<String>)> = Vec::new();
                for (mb_release_id, mb_release_title) in &mb_releases {
                    let mb_tracks = tracks_by_release.get(mb_release_id)
                        .map(|v| v.as_slice())
                        .unwrap_or(&[]);

                    if let Ok((status, reason, _)) = check_release_status(
                        &pool, artist_id, mb_release_id, mb_release_title, mb_tracks,
                    ).await {
                        if status != MatchStatus::Missing {
                            linked += 1;
                            status_updates.push((status.as_str().to_string(), mb_release_id.clone(), reason));
                        }
                    }
                }

                // Batch update LocalRelease match statuses
                if !status_updates.is_empty() {
                    let statuses: Vec<String> = status_updates.iter().map(|(s, _, _)| s.clone()).collect();
                    let rel_ids: Vec<String> = status_updates.iter().map(|(_, id, _)| id.clone()).collect();
                    sqlx::query(
                        r#"UPDATE "LocalRelease" SET
                             "matchStatus" = t.status::"ReleaseStatus",
                             "updatedAt" = NOW()
                           FROM (SELECT UNNEST($1::text[]) as status, UNNEST($2::text[]) as release_id) t
                           WHERE "LocalRelease"."releaseId" = t.release_id"#,
                    )
                    .bind(&statuses)
                    .bind(&rel_ids)
                    .execute(&pool)
                    .await
                    .ok();

                    // Update MusicBrainzRelease with status + reason
                    for (status_str, mb_id, reason) in &status_updates {
                        sqlx::query(
                            r#"UPDATE "MusicBrainzRelease" SET
                                 status = $1::"ReleaseStatus",
                                 "statusReason" = $2,
                                 "updatedAt" = NOW()
                               WHERE id = $3"#,
                        )
                        .bind(status_str)
                        .bind(reason)
                        .bind(mb_id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                }

                if linked > 0 {
                    println!("    {} Linked {} local release(s)", "→".bright_black(), linked);
                }
                // Update totals for this artist after linking releases
                update_release_totals_for_artist(&pool, artist_id).await.ok();
                update_artist_totals_for_artist(&pool, artist_id).await.ok();
                synced += 1;
                // Process extra artists before continuing (e.g. "Christine and the Queens"
                // discovered from splitting "070 Shake & Christine and the Queens")
                if !extra_artists_to_sync.is_empty() {
                    pending_extra_artists.extend(extra_artists_to_sync);
                }
                continue;
            }

            // 2. Get artist detail (URLs, genres, tags, image)
            println!("    {} Fetching artist details...", "→".bright_black());
            match mb_get_artist_detail(&http_client, &mb_id, &mut limiter).await {
                Ok(detail) => {
                    // Collect URLs and genres, then batch insert
                    let mut url_batch: Vec<(String, String)> = Vec::new();
                    if let Some(ref rels) = detail.relations {
                        for rel in rels {
                            if let Some(ref url) = rel.url {
                                url_batch.push((rel.relation_type.clone(), url.resource.clone()));
                            }
                        }
                    }
                    let details_count = url_batch.len();
                    batch_upsert_artist_urls(&pool, artist_id, &url_batch).await.ok();

                    let mut genre_ids: Vec<String> = Vec::new();
                    if let Some(ref genres) = detail.genres {
                        for g in genres {
                            if g.count.unwrap_or(0) > 0 {
                                if let Ok(genre_id) = ensure_genre_cached(&pool, &g.name, &mut genre_cache).await {
                                    genre_ids.push(genre_id);
                                }
                            }
                        }
                    }
                    if let Some(ref tags) = detail.tags {
                        for t in tags {
                            if t.count.unwrap_or(0) > 0 {
                                if let Ok(genre_id) = ensure_genre_cached(&pool, &t.name, &mut genre_cache).await {
                                    genre_ids.push(genre_id);
                                }
                            }
                        }
                    }
                    genre_ids.sort();
                    genre_ids.dedup();
                    let genre_count = genre_ids.len();
                    batch_link_artist_genres(&pool, artist_id, &genre_ids).await.ok();

                    println!("      {} Saved {} URLs, {} genres", "✓".green(), details_count, genre_count);

                    // Artist image
                    if !args.skip_images {
                        print!("    {} Downloading artist image... ", "→".bright_black());
                        std::io::stdout().flush().ok();
                        let use_folder_img = is_single_artist_folder;
                        match download_artist_image(&http_client, &detail, &artist_name, &artist_slug, &artist_img_dir, &folder_path, &s3_client, &config, &pool, artist_id, use_folder_img).await {
                            Some((src, _)) => println!("\n      {} Downloaded from {} {}", "→".bright_black(), src, "✓".green()),
                            None => println!("{} (not found)", "✗".yellow()),
                        }
                    }
                }
                Err(e) => {
                    println!("      {} Error: {}", "✗".yellow(), e.yellow());
                }
            }

            // 3. Get release groups (discography)
            println!("    {} Fetching releases...", "→".bright_black());
            let release_groups = match mb_get_release_groups(&http_client, &mb_id, &mut limiter).await {
                Ok(rgs) => {
                    println!("      {} Found {} release groups", "✓".green(), rgs.len());
                    rgs
                }
                Err(e) => {
                    println!("      {} Error: {}", "✗".red(), e.bright_red());
                    failed_artists.push((artist_name.clone(), format!("Failed to fetch releases: {}", e)));
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[{}][SYNC] Failed to fetch releases for artist '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), artist_name, e).ok();
                    }
                    failed_sync += 1;
                    continue;
                }
            };

            let mut release_scores: Vec<f64> = Vec::new();
            let mut release_failures = 0u32;
            let mut skipped_singles = 0u32;
            let mut processed_releases = 0u32;
            let total_to_process = release_groups.iter().filter(|rg| should_skip_release(rg).is_none()).count();

            for rg in &release_groups {
                if let Some(skip_reason) = should_skip_release(rg) {
                    if args.verbose {
                        println!("      {} {} ({}) - Skipping ({})",
                            "↷".bright_black(),
                            rg.title.bright_black(),
                            rg.primary_type.as_deref().unwrap_or("Album").bright_black(),
                            skip_reason.yellow()
                        );
                    }
                    skipped_singles += 1;
                    continue;
                }

                processed_releases += 1;
                if args.verbose {
                    print!("      {} {} ({})... ",
                        "→".bright_black(),
                        rg.title.bright_white(),
                        rg.primary_type.as_deref().unwrap_or("Album").bright_black()
                    );
                    std::io::stdout().flush().ok();
                } else {
                    eprint!("\r    {} Syncing {}/{} releases...{}",
                        "→".bright_black(),
                        processed_releases,
                        total_to_process,
                        " ".repeat(20)
                    );
                }

                let release_type = rg.primary_type.as_deref().unwrap_or("Album");
                let year = rg
                    .first_release_date
                    .as_ref()
                    .and_then(|d| d.split('-').next())
                    .and_then(|y| y.parse::<i32>().ok());

                let type_id = match ensure_release_type_cached(&pool, release_type, &mut release_type_cache).await {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                let mb_release_id =
                    match upsert_mb_release(&pool, &rg.title, &type_id, year, &rg.id).await {
                        Ok(id) => id,
                        Err(e) => {
                            eprintln!(
                                "\n    Release '{}' by '{}': DB error - {}",
                                rg.title, artist_name, e
                            );
                            if let Ok(mut f) = error_log.lock() {
                                writeln!(f, "[{}][SYNC] DB error inserting release '{}' for artist '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), rg.title, artist_name, e).ok();
                            }
                            release_failures += 1;
                            continue;
                        }
                    };
                ensure_mb_release_artist_link(&pool, &mb_release_id, artist_id).await.ok();

                let release_tracks =
                    match mb_get_release_tracks(&http_client, &rg.id, &mut limiter).await {
                        Ok(rt) => {
                            if args.verbose { println!("{}", "✓".green()); }
                            rt
                        }
                        Err(e) => {
                            if args.verbose {
                                println!("{} {}", "✗".red(), e.yellow());
                            }
                            release_failures += 1;

                            if let Ok(mut f) = error_log.lock() {
                                writeln!(f, "[{}][SYNC] Failed to fetch tracks for release '{}' by '{}': {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), rg.title, artist_name, e).ok();
                            }

                            if e.contains("still unavailable after") {
                                if args.verbose {
                                    println!("      {} Stopping sync for '{}' due to persistent rate limiting",
                                        "⚠".yellow(), artist_name.yellow());
                                }
                                failed_artists.push((artist_name.clone(), "Persistent rate limiting".to_string()));
                                break;
                            }
                            continue;
                        }
                    };

                if let Some((_, tracks)) = release_tracks.first() {
                    delete_mb_tracks_for_release(&pool, &mb_release_id).await.ok();
                    batch_insert_mb_tracks(&pool, &mb_release_id, tracks, 1).await.ok();

                    let mb_track_pairs: Vec<(String, Option<i32>)> = tracks
                        .iter()
                        .map(|track| (track.title.clone(), track.position.map(|p| p as i32)))
                        .collect();

                    let (status, reason, score) = match check_release_status(
                        &pool, artist_id, &mb_release_id, &rg.title, &mb_track_pairs,
                    ).await {
                        Ok(result) => result,
                        Err(_) => (MatchStatus::Unknown, None, 0.0),
                    };

                    let now = Utc::now().naive_utc();
                    sqlx::query(
                        r#"UPDATE "MusicBrainzRelease" SET
                             status = $1::"ReleaseStatus",
                             "statusReason" = $2,
                             "updatedAt" = $3
                           WHERE id = $4"#,
                    )
                    .bind(status.as_str())
                    .bind(&reason)
                    .bind(now)
                    .bind(&mb_release_id)
                    .execute(&pool)
                    .await
                    .ok();

                    sqlx::query(
                        r#"UPDATE "LocalRelease" SET "matchStatus" = $1::"ReleaseStatus", "updatedAt" = NOW() WHERE "releaseId" = $2"#,
                    )
                    .bind(status.as_str())
                    .bind(&mb_release_id)
                    .execute(&pool)
                    .await
                    .ok();

                    release_scores.push(score);
                }
            }

            // Clear the progress line in non-verbose mode
            if !args.verbose && total_to_process > 0 {
                eprint!("\r{}\r", " ".repeat(60));
            }

            println!("    {} Processed {} releases ({} skipped, {} failed)",
                "→".bright_black(),
                processed_releases,
                skipped_singles,
                release_failures
            );

            let now = Utc::now().naive_utc();
            let all_processed = release_scores.len() > 0 || (processed_releases == 0 && release_failures == 0);

            if all_processed {
                let avg_score = if release_scores.is_empty() {
                    None
                } else {
                    Some(release_scores.iter().sum::<f64>() / release_scores.len() as f64)
                };

                sqlx::query(
                    r#"UPDATE "Artist" SET "averageMatchScore" = $1, "lastSyncedAt" = $2, "updatedAt" = $2 WHERE id = $3"#,
                )
                .bind(avg_score)
                .bind(now)
                .bind(artist_id)
                .execute(&pool)
                .await
                .ok();
            } else {
                sqlx::query(
                    r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(artist_id)
                .execute(&pool)
                .await
                .ok();

                failed_sync += 1;
                failed_artists.push((artist_name.clone(), "Could not process any releases".to_string()));
                if let Ok(mut f) = error_log.lock() {
                    writeln!(f, "[{}][SYNC] Artist '{}' could not process any releases", Utc::now().format("%Y-%m-%d %H:%M:%S"), artist_name).ok();
                }
            }

            if release_failures > 0 && all_processed {
                partial_sync += 1;
                synced_mb_ids.insert(mb_id.clone(), artist_id.clone());
                println!("    {} Partially synced ({} releases had issues)", "⚠".yellow(), release_failures);
            } else if all_processed {
                synced += 1;
                synced_mb_ids.insert(mb_id.clone(), artist_id.clone());
                if processed_releases == 0 && skipped_singles > 0 {
                    println!("    {} Synced (all releases were filtered types)", "✓".green().bold());
                } else {
                    println!("    {} Fully synced", "✓".green().bold());
                }
            } else {
                println!("    {} Failed to sync", "✗".red().bold());
            }

            // Collect extra artists for processing after the main loop
            pending_extra_artists.extend(extra_artists_to_sync);
        } // end of per-artist sync loop

        // --- Resolve compound TrackArtist names ---
        // Find track-level artist names that look compound (contain & or feat. etc.)
        // and resolve them into individual artists via MB release-group credits or splitting.
        {
            let folder_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
            if !folder_release_ids.is_empty() {
                // Get distinct track artist names that differ from any album artist
                let compound_candidates: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
                    r#"SELECT DISTINCT a.id, a.name, lrt.artist, lr.title
                       FROM "TrackArtist" ta
                       JOIN "Artist" a ON ta."artistId" = a.id
                       JOIN "LocalReleaseTrack" lrt ON lrt.id = ta."trackId"
                       JOIN "LocalRelease" lr ON lr.id = lrt."localReleaseId"
                       WHERE lrt."localReleaseId" = ANY($1::text[])
                         AND a."musicbrainzId" IS NULL
                         AND a.id NOT IN (
                             SELECT DISTINCT lra."artistId" FROM "LocalReleaseArtist" lra
                             WHERE lra."localReleaseId" = ANY($1::text[])
                         )"#,
                )
                .bind(&folder_release_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                // Build anchor from known synced album artists in this folder
                let folder_anchor: Option<MbArtistMatch> = {
                    let mut found = None;
                    for aid in &folder_artist_ids {
                        if let Some(mb_id) = synced_mb_ids.keys().find(|mid| synced_mb_ids.get(*mid) == Some(aid)) {
                            let name: Option<(String,)> = sqlx::query_as(
                                r#"SELECT name FROM "Artist" WHERE id = $1"#,
                            ).bind(aid).fetch_optional(&pool).await.unwrap_or(None);
                            if let Some((n,)) = name {
                                found = Some(MbArtistMatch { id: mb_id.clone(), name: n, score: Some(100) });
                                break;
                            }
                        }
                    }
                    found
                };

                let mut seen_extra_ids: HashSet<String> = pending_extra_artists.iter().map(|(_, m)| m.id.clone()).collect();
                for (_artist_id, artist_name, raw_artist, _album_title) in &compound_candidates {
                    let tag = raw_artist.as_deref().unwrap_or(artist_name);

                    // Use the folder's album artist as anchor for splitting.
                    // This enables & and , separators since we have a confirmed artist.
                    if let Ok(Some((_primary, additional))) = try_split_tag(
                        &http_client, tag, artist_name, &folder_anchor, &mut limiter,
                    ).await {
                        for (name, m) in additional {
                            if !synced_mb_ids.contains_key(&m.id) && seen_extra_ids.insert(m.id.clone()) {
                                pending_extra_artists.push((name, m));
                            }
                        }
                    }
                }
            }
        }

        // Sync additional artists discovered from compound name splits
        for (extra_name, extra_match) in pending_extra_artists {
                // Skip if already synced this run
                if synced_mb_ids.contains_key(&extra_match.id) {
                    continue;
                }

                // Check if this artist already exists and has an MB ID
                let extra_slug = make_slug(&extra_name);
                let existing: Option<(String, Option<String>)> = sqlx::query_as(
                    r#"SELECT id, "musicbrainzId" FROM "Artist" WHERE slug = $1"#,
                )
                .bind(&extra_slug)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None);

                if !args.overwrite {
                    if let Some((_, Some(_))) = &existing {
                        continue; // already has MB ID
                    }
                }

                // Check for matching local releases BEFORE creating the artist.
                // Only match on albumArtist (not track-level artist) to avoid
                // elevating featured credits to album-level links.
                let compound_releases: Vec<(String,)> = sqlx::query_as(
                    r#"SELECT DISTINCT lrt."localReleaseId"
                       FROM "LocalReleaseTrack" lrt
                       JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
                       WHERE lra."artistId" = ANY($1::text[])
                         AND lrt."albumArtist" ILIKE '%' || $2 || '%'"#,
                )
                .bind(&folder_artist_ids.iter().cloned().collect::<Vec<_>>())
                .bind(&extra_name)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                // Skip artists with no local releases — don't even create the record
                if compound_releases.is_empty() {
                    continue;
                }

                // NOW create the Artist record (we know it has matches)
                let extra_artist_id = match ensure_artist_cached(&pool, &extra_name, &mut artist_cache).await {
                    Ok(id) if !id.is_empty() => id,
                    _ => continue,
                };

                let links: Vec<(String, String)> = compound_releases.iter()
                    .map(|(rel_id,)| (rel_id.clone(), extra_artist_id.clone()))
                    .collect();
                let release_link_count = links.len();
                batch_ensure_local_release_artists(&pool, &links).await.ok();

                println!(
                    "    {} {}",
                    "Syncing (from split):".white(),
                    extra_name.bright_cyan().bold()
                );
                println!("    {} Linked to {} local release(s)", "→".bright_black(), release_link_count);

                // Save MB ID
                sqlx::query(
                    r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                )
                .bind(&extra_match.id)
                .bind(&extra_artist_id)
                .execute(&pool)
                .await
                .ok();

                let extra_mb_id = extra_match.id;

                // Fetch artist details
                println!("    {} Fetching artist details...", "→".bright_black());
                match mb_get_artist_detail(&http_client, &extra_mb_id, &mut limiter).await {
                    Ok(detail) => {
                        let mut url_batch: Vec<(String, String)> = Vec::new();
                        if let Some(ref rels) = detail.relations {
                            for rel in rels {
                                if let Some(ref url) = rel.url {
                                    url_batch.push((rel.relation_type.clone(), url.resource.clone()));
                                }
                            }
                        }
                        let details_count = url_batch.len();
                        batch_upsert_artist_urls(&pool, &extra_artist_id, &url_batch).await.ok();

                        let mut genre_ids: Vec<String> = Vec::new();
                        if let Some(ref genres) = detail.genres {
                            for g in genres {
                                if g.count.unwrap_or(0) > 0 {
                                    if let Ok(genre_id) = ensure_genre_cached(&pool, &g.name, &mut genre_cache).await {
                                        genre_ids.push(genre_id);
                                    }
                                }
                            }
                        }
                        if let Some(ref tags) = detail.tags {
                            for t in tags {
                                if t.count.unwrap_or(0) > 0 {
                                    if let Ok(genre_id) = ensure_genre_cached(&pool, &t.name, &mut genre_cache).await {
                                        genre_ids.push(genre_id);
                                    }
                                }
                            }
                        }
                        genre_ids.sort();
                        genre_ids.dedup();
                        let genre_count = genre_ids.len();
                        batch_link_artist_genres(&pool, &extra_artist_id, &genre_ids).await.ok();

                        println!("      {} Saved {} URLs, {} genres", "✓".green(), details_count, genre_count);

                        if !args.skip_images {
                            print!("    {} Downloading artist image... ", "→".bright_black());
                            std::io::stdout().flush().ok();
                            match download_artist_image(
                                &http_client, &detail, &extra_name, &extra_slug, &artist_img_dir,
                                &folder_path, &s3_client, &config, &pool, &extra_artist_id,
                                false,
                            ).await {
                                Some((src, _)) => println!("\n      {} Downloaded from {} {}", "→".bright_black(), src, "✓".green()),
                                None => println!("{} (not found)", "✗".yellow()),
                            }
                        }
                    }
                    Err(e) => {
                        println!("      {} Error: {}", "✗".yellow(), e.yellow());
                    }
                }

                // Full catalogue sync — treat extra artists the same as primary
                println!("    {} Fetching releases...", "→".bright_black());
                match mb_get_release_groups(&http_client, &extra_mb_id, &mut limiter).await {
                    Ok(rgs) => {
                        println!("      {} Found {} release groups", "✓".green(), rgs.len());
                        let mut release_scores: Vec<f64> = Vec::new();
                        let mut release_failures = 0u32;
                        let mut skipped_count = 0u32;
                        let mut processed_count = 0u32;
                        let total_to_process = rgs.iter().filter(|r| should_skip_release(r).is_none()).count();

                        for rg in &rgs {
                            if should_skip_release(rg).is_some() {
                                skipped_count += 1;
                                continue;
                            }
                            processed_count += 1;
                            if !args.verbose {
                                eprint!("\r    {} Syncing {}/{} releases...{}",
                                    "→".bright_black(), processed_count, total_to_process, " ".repeat(20));
                            }

                            let release_type = rg.primary_type.as_deref().unwrap_or("Album");
                            let year = rg.first_release_date.as_ref()
                                .and_then(|d| d.split('-').next())
                                .and_then(|y| y.parse::<i32>().ok());

                            let type_id = match ensure_release_type_cached(&pool, release_type, &mut release_type_cache).await {
                                Ok(id) => id,
                                Err(_) => continue,
                            };

                            let mb_release_id = match upsert_mb_release(&pool, &rg.title, &type_id, year, &rg.id).await {
                                Ok(id) => id,
                                Err(_) => { release_failures += 1; continue; }
                            };
                            ensure_mb_release_artist_link(&pool, &mb_release_id, &extra_artist_id).await.ok();

                            match mb_get_release_tracks(&http_client, &rg.id, &mut limiter).await {
                                Ok(rt) => {
                                    if let Some((_, tracks)) = rt.first() {
                                        delete_mb_tracks_for_release(&pool, &mb_release_id).await.ok();
                                        batch_insert_mb_tracks(&pool, &mb_release_id, tracks, 1).await.ok();
                                        let mb_track_pairs: Vec<(String, Option<i32>)> = tracks.iter()
                                            .map(|t| (t.title.clone(), t.position.map(|p| p as i32)))
                                            .collect();
                                        let (status, reason, score) = match check_release_status(
                                            &pool, &extra_artist_id, &mb_release_id, &rg.title, &mb_track_pairs,
                                        ).await {
                                            Ok(r) => r,
                                            Err(_) => (MatchStatus::Unknown, None, 0.0),
                                        };
                                        let now = Utc::now().naive_utc();
                                        sqlx::query(r#"UPDATE "MusicBrainzRelease" SET status = $1::"ReleaseStatus", "statusReason" = $2, "updatedAt" = $3 WHERE id = $4"#)
                                            .bind(status.as_str()).bind(&reason).bind(now).bind(&mb_release_id).execute(&pool).await.ok();
                                        sqlx::query(r#"UPDATE "LocalRelease" SET "matchStatus" = $1::"ReleaseStatus", "updatedAt" = NOW() WHERE "releaseId" = $2"#)
                                            .bind(status.as_str()).bind(&mb_release_id).execute(&pool).await.ok();
                                        release_scores.push(score);
                                    }
                                }
                                Err(e) => {
                                    release_failures += 1;
                                    if e.contains("still unavailable after") { break; }
                                }
                            }
                        }

                        if !args.verbose && total_to_process > 0 {
                            eprint!("\r{}\r", " ".repeat(60));
                        }
                        println!("    {} Processed {} releases ({} skipped, {} failed)",
                            "→".bright_black(), processed_count, skipped_count, release_failures);

                        let now = Utc::now().naive_utc();
                        let avg_score = if release_scores.is_empty() { None }
                            else { Some(release_scores.iter().sum::<f64>() / release_scores.len() as f64) };
                        sqlx::query(r#"UPDATE "Artist" SET "averageMatchScore" = $1, "lastSyncedAt" = $2, "updatedAt" = $2 WHERE id = $3"#)
                            .bind(avg_score).bind(now).bind(&extra_artist_id).execute(&pool).await.ok();

                        synced_mb_ids.insert(extra_mb_id.clone(), extra_artist_id.clone());
                        update_release_totals_for_artist(&pool, &extra_artist_id).await.ok();
                        update_artist_totals_for_artist(&pool, &extra_artist_id).await.ok();
                        synced += 1;
                        println!("    {} Fully synced", "✓".green().bold());
                    }
                    Err(e) => {
                        println!("      {} Error: {}", "✗".red(), e.bright_red());
                        failed_sync += 1;
                    }
                }
        }

        // --- Step 5b: Clean up empty artists ---
        // Remove artist records created during indexing from compound tags
        // (e.g. "Chaz Bundick & ScHoolboy Q") that have no MB match, no local
        // releases, and no tracks — these are ghosts from unsplit compound names.
        // Covers both album-level artists (folder_artist_ids) and track-level artists.
        {
            let folder_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
            if !folder_release_ids.is_empty() {
                // Find all artist IDs touched in this folder (album + track level)
                let all_folder_aids: Vec<(String,)> = sqlx::query_as(
                    r#"SELECT DISTINCT a.id FROM "Artist" a
                       WHERE (
                           a.id = ANY($1::text[])
                           OR EXISTS (
                               SELECT 1 FROM "TrackArtist" ta
                               JOIN "LocalReleaseTrack" lrt ON lrt.id = ta."trackId"
                               WHERE ta."artistId" = a.id
                                 AND lrt."localReleaseId" = ANY($2::text[])
                           )
                           OR EXISTS (
                               SELECT 1 FROM "LocalReleaseArtist" lra
                               WHERE lra."artistId" = a.id
                                 AND lra."localReleaseId" = ANY($2::text[])
                           )
                       )
                       AND a."musicbrainzId" IS NULL
                       AND a."totalTracks" = 0"#,
                )
                .bind(&folder_artist_ids.iter().cloned().collect::<Vec<_>>())
                .bind(&folder_release_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                let empty_aids: Vec<String> = all_folder_aids.into_iter().map(|(id,)| id).collect();
                if !empty_aids.is_empty() {
                    // Delete TrackArtist links first (FK constraint)
                    sqlx::query(
                        r#"DELETE FROM "TrackArtist" WHERE "artistId" = ANY($1::text[])"#,
                    )
                    .bind(&empty_aids)
                    .execute(&pool)
                    .await
                    .ok();
                    // Delete LocalReleaseArtist links
                    sqlx::query(
                        r#"DELETE FROM "LocalReleaseArtist" WHERE "artistId" = ANY($1::text[])"#,
                    )
                    .bind(&empty_aids)
                    .execute(&pool)
                    .await
                    .ok();
                    // Delete the empty artist records
                    let deleted: Vec<(String,)> = sqlx::query_as(
                        r#"DELETE FROM "Artist" WHERE id = ANY($1::text[]) RETURNING id"#,
                    )
                    .bind(&empty_aids)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default();
                    for (id,) in &deleted {
                        artist_cache.retain(|_, v| v != id);
                        folder_artist_ids.remove(id);
                    }
                }
            }
        }

        // --- Step 6: Cover Art Archive fallback ---
        if !args.skip_images {
            // Find releases still missing art after embedded + folder image steps
            let still_missing_art: Vec<(String, String)> = folder_releases.iter()
                .filter(|(rid, _)| !releases_with_art.contains(*rid))
                .map(|(rid, fp)| (rid.clone(), fp.clone()))
                .collect();

            if !still_missing_art.is_empty() {
                // Pre-fetch all release metadata + MB release group IDs in one query
                let missing_ids: Vec<String> = still_missing_art.iter().map(|(id, _)| id.clone()).collect();
                let caa_metadata: Vec<(String, String, Option<String>)> = sqlx::query_as(
                    r#"SELECT lr.id, lr.title, mbr."musicbrainzId"
                       FROM "LocalRelease" lr
                       LEFT JOIN "MusicBrainzRelease" mbr ON lr."releaseId" = mbr.id
                       WHERE lr.id = ANY($1::text[])"#,
                )
                .bind(&missing_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                let caa_map: HashMap<String, (String, Option<String>)> = caa_metadata.into_iter()
                    .map(|(id, title, mb_id)| (id, (title, mb_id)))
                    .collect();

                let mut caa_downloaded = 0u32;
                let mut caa_not_found = 0u32;

                for (release_id, rel_folder_path) in &still_missing_art {
                    let (title, rg_id) = match caa_map.get(release_id) {
                        Some((t, Some(mb_id))) => (t.clone(), mb_id.clone()),
                        _ => continue, // No MB link, skip
                    };

                    let out_path = release_img_dir.join(format!("{}.jpg", release_id));
                    let abs_folder = PathBuf::from(&music_dir).join(rel_folder_path);

                    match download_cover_art(&http_client, &rg_id, &out_path, &abs_folder).await {
                        Ok((true, wrote_folder_jpg)) => {
                            caa_downloaded += 1;
                            let suffix = if wrote_folder_jpg { " (+ saved folder.jpg)" } else { "" };
                            println!("    {} Downloaded cover from Cover Art Archive: {}{}",
                                "↓".green(), title.bright_black(), suffix.bright_black());

                            if use_s3 {
                                if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                                    (&s3_client, &config.s3_bucket, &config.s3_public_url)
                                {
                                    let s3_key = format!("releases/{}.jpg", release_id);
                                    match upload_to_s3(client, bucket, &s3_key, &out_path).await {
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
                                                writeln!(f, "[{}][SYNC] S3 upload failed for release {}: {:?}",
                                                    Utc::now().format("%Y-%m-%d %H:%M:%S"), release_id, e).ok();
                                            }
                                        }
                                    }
                                }
                            }

                            if use_local {
                                let filename = format!("{}.jpg", release_id);
                                sqlx::query(
                                    r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&filename)
                                .bind(release_id)
                                .execute(&pool)
                                .await
                                .ok();
                            }

                            releases_with_art.insert(release_id.clone());
                        }
                        Ok((false, _)) => {
                            caa_not_found += 1;
                        }
                        Err(e) => {
                            caa_not_found += 1;
                            if let Ok(mut f) = error_log.lock() {
                                writeln!(f, "[{}][SYNC] Cover Art Archive error for release '{}': {}",
                                    Utc::now().format("%Y-%m-%d %H:%M:%S"), title, e).ok();
                            }
                        }
                    }
                }

                if caa_downloaded > 0 || caa_not_found > 0 {
                    println!("    {} Cover Art Archive: {} downloaded, {} not found",
                        "→".bright_black(),
                        caa_downloaded.to_string().bright_green(),
                        caa_not_found.to_string().bright_black());
                }
            }
        }

        // --- Cleanup: remove local temp images in S3-only mode ---
        if !use_local && use_s3 {
            for rid in &releases_with_art {
                let tmp_path = release_img_dir.join(format!("{}.jpg", rid));
                if tmp_path.exists() {
                    fs::remove_file(&tmp_path).ok();
                }
            }
        }

        // --- Save progress ---
        save_sync_progress(&pool, folder_name).await.ok();
    }

    // --- Finalization ---
    println!();
    println!("Finalizing...");

    // Index summary
    println!(
        "  Index: {} files in {} folders | New: {} | Updated: {} | Skipped: {} | Errors: {}",
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
        for (artist_name, count) in &artists_with_errors {
            println!(
                "    Unable to parse {} file{} for {}. See errors.log.",
                count.to_string().red(),
                if *count == 1 { "" } else { "s" },
                artist_name.bright_white(),
            );
        }
    }

    // Sync summary
    println!(
        "  Sync:  Synced: {} | Partial: {} | Failed: {}",
        synced.to_string().bright_green(),
        partial_sync.to_string().bright_yellow(),
        if failed_sync > 0 { failed_sync.to_string().red() } else { "0".to_string().bright_black() }
    );

    update_statistics(&pool).await.ok();
    clear_sync_progress(&pool).await.ok();

    let elapsed = start.elapsed();
    let total_secs = elapsed.as_secs();
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    println!();
    println!("{}", "═".repeat(60).bright_black());
    println!();
    println!("Ended at      : {} ({}h:{}m:{}s)",
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string().bright_white(),
        h, m, s);
    println!("  {} {}", "New tracks:".green(), new_total);
    println!("  {} {}", "Updated:".yellow(), updated_total);
    println!("  {} {}", "Skipped:".bright_black(), skipped_total);
    let total_errors = scan_error_total + db_error_total;
    if total_errors > 0 {
        println!("  {} {}", "Errors:".red(), total_errors);
    }
    println!("  {} {} synced, {} partial, {} failed",
        "MB sync:".cyan(), synced, partial_sync, failed_sync);

    if !failed_artists.is_empty() {
        println!();
        println!("{}", "Failed Artists:".red().bold());
        for (name, reason) in &failed_artists {
            println!("  {} {} - {}", "✗".red(), name.bright_white(), reason.bright_black());
        }
    }

    if partial_sync > 0 || failed_sync > 0 {
        println!();
        println!("{} Run {} again to retry failed artists.",
            "Tip:".yellow().bold(),
            "./sync".bright_cyan()
        );
    }
}
