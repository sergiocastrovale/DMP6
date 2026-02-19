use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client as S3Client;
use chrono::Utc;
use clap::Parser;
use colored::*;
use dotenvy;
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use slug::slugify;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::time::sleep;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-sync", about = "Sync local catalogue with MusicBrainz")]
struct Args {
    /// Re-sync all artists (including already synced ones)
    #[arg(long)]
    overwrite: bool,

    /// Only sync artists starting with this prefix (case insensitive)
    #[arg(long)]
    only: Option<String>,

    /// Sync artists starting from this prefix (case insensitive)
    #[arg(long)]
    from: Option<String>,

    /// Sync artists up to and including this prefix (case insensitive)
    #[arg(long)]
    to: Option<String>,

    /// Limit to first N artists
    #[arg(long, default_value = "0")]
    limit: usize,
}

// ---------------------------------------------------------------------------
// MusicBrainz API types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct MbArtistSearchResult {
    artists: Vec<MbArtistMatch>,
}

#[derive(Debug, Deserialize)]
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

// Fanart.tv
#[derive(Debug, Deserialize)]
struct FanartArtistResponse {
    artistthumb: Option<Vec<FanartImage>>,
    artistbackground: Option<Vec<FanartImage>>,
    #[allow(dead_code)]
    hdmusiclogo: Option<Vec<FanartImage>>,
}

#[derive(Debug, Deserialize)]
struct FanartImage {
    url: String,
}

// Wikipedia types (used via dynamic JSON parsing in get_wikipedia_image)

// ---------------------------------------------------------------------------
// Adaptive rate limiter
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
            delay_ms: 1000,      // Start at 1 second (conservative)
            min_delay: 1000,     // Never go below 1 second
            max_delay: 10000,    // Max 10 seconds between requests
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
        // Gradually reduce delay on success (but never below min)
        if self.delay_ms > self.min_delay {
            self.delay_ms = (self.delay_ms * 95 / 100).max(self.min_delay);
        }
    }

    fn on_rate_limit(&mut self) {
        // Double the delay on rate limit
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
    let mut wait_time = limiter.delay_ms; // Start with current rate limit delay
    
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
                // Exponential backoff: double the wait time each retry
                wait_time = (wait_time * 2).min(60000); // Cap at 60 seconds per retry
                
                let reason = if status == 503 {
                    "MB server busy"
                } else {
                    "Rate limited"
                };
                
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

        // Other errors (404, 400, etc) fail immediately
        return Err(format!("HTTP {} for {}", status, url));
    }

    Err("Max retries exceeded".to_string())
}

async fn mb_search_artist(
    client: &Client,
    name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    let encoded = urlencoding::encode(name);
    let url = format!("{}/artist/?query=artist:{}&limit=5&fmt=json", MB_BASE, encoded);
    let body = mb_get(client, &url, limiter).await?;
    let result: MbArtistSearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    // Return best match with score >= 90
    Ok(result
        .artists
        .into_iter()
        .find(|a| a.score.unwrap_or(0) >= 90))
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
// Filter
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Release type filtering
// ---------------------------------------------------------------------------

fn should_skip_release(rg: &MbReleaseGroup) -> Option<String> {
    let skip_primary = ["Single", "Broadcast"];
    let skip_secondary = [
        "Compilation",
        "Live",
        "Remix",
        "DJ-mix",
        "Mixtape/Street",
        "Demo",
        "Interview",
        "Bootleg",
    ];

    // Only skip certain secondary types; actually keep Compilation and Live
    // Based on instructions: skip Singles, Bootlegs, Demos, Unofficial, Interviews, Broadcasts
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

    // Skip unofficial (in secondary types)
    let _ = skip_primary;
    let _ = skip_secondary;

    None
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async fn ensure_release_type(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let type_slug = slugify(name);
    let existing: Option<(String,)> =
        sqlx::query_as(r#"SELECT id FROM "ReleaseType" WHERE slug = $1"#)
            .bind(&type_slug)
            .fetch_optional(pool)
            .await?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (slug) DO NOTHING"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&type_slug)
    .bind(now)
    .execute(pool)
    .await?;

    let row: (String,) = sqlx::query_as(r#"SELECT id FROM "ReleaseType" WHERE slug = $1"#)
        .bind(&type_slug)
        .fetch_one(pool)
        .await?;

    Ok(row.0)
}

async fn ensure_genre(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let existing: Option<(String,)> =
        sqlx::query_as(r#"SELECT id FROM "Genre" WHERE name = $1"#)
            .bind(name)
            .fetch_optional(pool)
            .await?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Genre" (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING"#,
    )
    .bind(&id)
    .bind(name)
    .execute(pool)
    .await?;

    let row: (String,) = sqlx::query_as(r#"SELECT id FROM "Genre" WHERE name = $1"#)
        .bind(name)
        .fetch_one(pool)
        .await?;

    Ok(row.0)
}

async fn upsert_artist_url(
    pool: &PgPool,
    artist_id: &str,
    url_type: &str,
    url: &str,
) -> Result<(), sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "ArtistUrl" (id, type, url, "artistId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $5)
           ON CONFLICT ("artistId", type, url) DO NOTHING"#,
    )
    .bind(&id)
    .bind(url_type)
    .bind(url)
    .bind(artist_id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn upsert_mb_release(
    pool: &PgPool,
    artist_id: &str,
    title: &str,
    type_id: &str,
    year: Option<i32>,
    mb_id: &str,
) -> Result<String, sqlx::Error> {
    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "musicbrainz_releases" WHERE "artistId" = $1 AND title = $2"#,
    )
    .bind(artist_id)
    .bind(title)
    .fetch_optional(pool)
    .await?;

    if let Some((id,)) = existing {
        let now = Utc::now().naive_utc();
        sqlx::query(
            r#"UPDATE "musicbrainz_releases" SET
                 "typeId" = $1, year = $2, "musicbrainzId" = $3, "updatedAt" = $4
               WHERE id = $5"#,
        )
        .bind(type_id)
        .bind(year)
        .bind(mb_id)
        .bind(now)
        .bind(&id)
        .execute(pool)
        .await?;
        return Ok(id);
    }

    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "musicbrainz_releases"
           (id, title, "artistId", "typeId", year, "musicbrainzId", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, 'UNKNOWN', $7, $7)
           ON CONFLICT ("artistId", title) DO UPDATE SET
             "typeId" = $4, year = $5, "musicbrainzId" = $6, "updatedAt" = $7
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(artist_id)
    .bind(type_id)
    .bind(year)
    .bind(mb_id)
    .bind(now)
    .fetch_one(pool)
    .await
    .map(|row| row.get::<String, _>("id"))
}

async fn upsert_mb_track(
    pool: &PgPool,
    release_id: &str,
    title: &str,
    position: Option<i32>,
    disc_number: Option<i32>,
    duration_ms: Option<i32>,
    mb_id: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "musicbrainz_release_tracks"
           (id, title, position, "discNumber", "durationMs", "musicbrainzId", "releaseId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           ON CONFLICT DO NOTHING
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(position)
    .bind(disc_number)
    .bind(duration_ms)
    .bind(mb_id)
    .bind(release_id)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(|r| r.get::<String, _>("id")).unwrap_or(id))
}

async fn delete_mb_tracks_for_release(
    pool: &PgPool,
    release_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"DELETE FROM "musicbrainz_release_tracks" WHERE "releaseId" = $1"#,
    )
    .bind(release_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn link_artist_genre(
    pool: &PgPool,
    artist_id: &str,
    genre_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "_ArtistGenres" ("A", "B")
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(artist_id)
    .bind(genre_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[allow(dead_code)]
async fn link_release_genre(
    pool: &PgPool,
    release_id: &str,
    genre_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "_ReleaseGenres" ("A", "B")
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(release_id)
    .bind(genre_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn update_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    use chrono::Utc;
    let now = Utc::now().naive_utc();
    
    // Count artists synced with MusicBrainz
    let artists_synced: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::bigint FROM "Artist" WHERE "musicbrainzId" IS NOT NULL"#
    )
    .fetch_one(pool)
    .await?;
    
    // Count MB releases
    let mb_releases: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::bigint FROM "musicbrainz_releases""#
    )
    .fetch_one(pool)
    .await?;
    
    // Count artists with images
    let artists_with_art: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::bigint FROM "Artist" WHERE image IS NOT NULL"#
    )
    .fetch_one(pool)
    .await?;
    
    // Count genres
    let genre_count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::bigint FROM "Genre""#
    )
    .fetch_one(pool)
    .await?;
    
    // Update statistics (only MB-specific fields, preserve index fields)
    sqlx::query(
        r#"INSERT INTO "Statistics" (
             id, 
             "artistsSyncedWithMusicbrainz", 
             "releasesSyncedWithMusicbrainz",
             "artistsWithCoverArt",
             genres,
             "updatedAt"
           )
           VALUES ('main', $1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             "artistsSyncedWithMusicbrainz" = $1,
             "releasesSyncedWithMusicbrainz" = $2,
             "artistsWithCoverArt" = $3,
             genres = $4,
             "updatedAt" = $5"#,
    )
    .bind(artists_synced.0 as i32)
    .bind(mb_releases.0 as i32)
    .bind(artists_with_art.0 as i32)
    .bind(genre_count.0 as i32)
    .bind(now)
    .execute(pool)
    .await?;
    
    Ok(())
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
enum MatchStatus {
    Complete,
    Incomplete,
    ExtraTracks,
    Missing,
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

    #[allow(dead_code)]
    fn score(&self) -> f64 {
        match self {
            Self::Complete | Self::ExtraTracks => 1.0,
            _ => 0.0,
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
    mb_tracks: &[(String, Option<i32>)], // (title, position)
) -> Result<(MatchStatus, Option<JsonValue>, Option<JsonValue>, f64), sqlx::Error> {
    // Find matching local release
    let local_release: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "LocalRelease" WHERE "artistId" = $1 AND LOWER(title) = LOWER($2)"#,
    )
    .bind(artist_id)
    .bind(mb_release_title)
    .fetch_optional(pool)
    .await?;

    let local_release_id = match local_release {
        Some((id,)) => id,
        None => {
            return Ok((MatchStatus::Missing, None, None, 0.0));
        }
    };

    // Link MB release to local release
    sqlx::query(
        r#"UPDATE "LocalRelease" SET "releaseId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
    )
    .bind(mb_release_id)
    .bind(&local_release_id)
    .execute(pool)
    .await?;

    // Get local tracks
    let local_tracks: Vec<(String,)> = sqlx::query_as(
        r#"SELECT COALESCE(title, '') FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
    )
    .bind(&local_release_id)
    .fetch_all(pool)
    .await?;

    let local_titles: Vec<String> = local_tracks
        .iter()
        .map(|(t,)| normalize_title(t))
        .collect();

    let mb_titles: Vec<String> = mb_tracks
        .iter()
        .map(|(t, _)| normalize_title(t))
        .collect();

    // Find missing and extra
    let missing: Vec<String> = mb_tracks
        .iter()
        .filter(|(t, _)| !local_titles.contains(&normalize_title(t)))
        .map(|(t, _)| t.clone())
        .collect();

    let extra: Vec<String> = local_tracks
        .iter()
        .filter(|(t,)| !mb_titles.contains(&normalize_title(t)))
        .map(|(t,)| t.clone())
        .collect();

    let mb_count = mb_tracks.len() as f64;
    let matched_count = mb_count - missing.len() as f64;

    if missing.is_empty() && extra.is_empty() {
        Ok((MatchStatus::Complete, None, None, 1.0))
    } else if missing.is_empty() && !extra.is_empty() {
        let extra_json = serde_json::to_value(&extra).ok();
        Ok((MatchStatus::ExtraTracks, None, extra_json, 1.0))
    } else if !missing.is_empty() {
        let missing_json = serde_json::to_value(&missing).ok();
        let extra_json = if extra.is_empty() {
            None
        } else {
            serde_json::to_value(&extra).ok()
        };
        let score = if mb_count > 0.0 {
            matched_count / mb_count
        } else {
            0.0
        };
        Ok((MatchStatus::Incomplete, missing_json, extra_json, score))
    } else {
        Ok((MatchStatus::Unknown, None, None, 0.0))
    }
}

// ---------------------------------------------------------------------------
// Artist image download
// ---------------------------------------------------------------------------

async fn download_artist_image(
    client: &Client,
    artist: &MbArtistDetail,
    artist_slug: &str,
    img_dir: &PathBuf,
    s3_client: &Option<S3Client>,
    config: &SyncConfig,
    pool: &PgPool,
    artist_id: &str,
) -> Option<String> {
    let out_path = img_dir.join(format!("{}.jpg", artist_slug));
    if out_path.exists() {
        return Some(format!("/img/artists/{}.jpg", artist_slug));
    }

    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let use_local = config.image_storage == "local" || config.image_storage == "both";

    // Try Wikipedia image first (from MB relations)
    if let Some(ref relations) = artist.relations {
        for rel in relations {
            if rel.relation_type == "wikipedia" || rel.relation_type == "wikidata" {
                if let Some(ref url) = rel.url {
                    if let Some(img_url) = get_wikipedia_image(client, &url.resource).await {
                        if download_and_resize(client, &img_url, &out_path).await {
                            // Upload to S3 if needed
                            if use_s3 {
                                if let (Some(ref s3), Some(ref bucket), Some(ref public_url)) = 
                                    (s3_client, &config.s3_bucket, &config.s3_public_url) {
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
                                    }
                                }
                            }

                            // Set local path if needed
                            if use_local {
                                let local_path = format!("/img/artists/{}.jpg", artist_slug);
                                sqlx::query(
                                    r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&local_path)
                                .bind(artist_id)
                                .execute(pool)
                                .await
                                .ok();
                            }

                            // Delete local file if only using S3
                            if !use_local && use_s3 && out_path.exists() {
                                fs::remove_file(&out_path).ok();
                            }

                            return Some(format!("/img/artists/{}.jpg", artist_slug));
                        }
                    }
                }
            }
        }
    }

    // Try Fanart.tv
    if let Some(img_url) = get_fanart_image(client, &artist.id).await {
        if download_and_resize(client, &img_url, &out_path).await {
            // Upload to S3 if needed
            if use_s3 {
                if let (Some(ref s3), Some(ref bucket), Some(ref public_url)) = 
                    (s3_client, &config.s3_bucket, &config.s3_public_url) {
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
                    }
                }
            }

            // Set local path if needed
            if use_local {
                let local_path = format!("/img/artists/{}.jpg", artist_slug);
                sqlx::query(
                    r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                )
                .bind(&local_path)
                .bind(artist_id)
                .execute(pool)
                .await
                .ok();
            }

            // Delete local file if only using S3
            if !use_local && use_s3 && out_path.exists() {
                fs::remove_file(&out_path).ok();
            }

            return Some(format!("/img/artists/{}.jpg", artist_slug));
        }
    }

    None
}

async fn get_wikipedia_image(client: &Client, wiki_url: &str) -> Option<String> {
    // Extract page title from URL
    let title = wiki_url.rsplit('/').next()?;

    // Handle wikidata URLs - fetch from Wikidata API
    if wiki_url.contains("wikidata.org") {
        // Get Wikidata entity ID (e.g., Q175097 from https://www.wikidata.org/wiki/Q175097)
        let wikidata_id = title;
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
        
        // Get P18 (image) property from claims
        if let Some(entities) = body.get("entities") {
            if let Some(entity) = entities.get(wikidata_id) {
                if let Some(claims) = entity.get("claims") {
                    if let Some(images) = claims.get("P18") {
                        if let Some(first_image) = images.get(0) {
                            if let Some(mainsnak) = first_image.get("mainsnak") {
                                if let Some(datavalue) = mainsnak.get("datavalue") {
                                    if let Some(value) = datavalue.get("value") {
                                        if let Some(filename) = value.as_str() {
                                            // Convert Wikimedia filename to direct URL
                                            let filename_encoded = urlencoding::encode(filename);
                                            return Some(format!(
                                                "https://commons.wikimedia.org/wiki/Special:FilePath/{}?width=500",
                                                filename_encoded
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return None;
    }

    let api_url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&titles={}&prop=pageimages&format=json&pithumbsize=500",
        title
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

async fn get_fanart_image(client: &Client, mb_id: &str) -> Option<String> {
    // Fanart.tv API - no key needed for basic access
    let url = format!(
        "https://webservice.fanart.tv/v3/music/{}?api_key={}",
        mb_id, "NO_KEY"
    );

    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .ok()?;

    if resp.status() != 200 {
        return None;
    }

    let data: FanartArtistResponse = resp.json().await.ok()?;

    // Prefer artistthumb > artistbackground > hdmusiclogo
    if let Some(ref thumbs) = data.artistthumb {
        if let Some(first) = thumbs.first() {
            return Some(first.url.clone());
        }
    }
    if let Some(ref bgs) = data.artistbackground {
        if let Some(first) = bgs.first() {
            return Some(first.url.clone());
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
                img.resize_to_fill(200, 200, image::imageops::FilterType::Lanczos3);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            resized.save(out_path).is_ok()
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct SyncConfig {
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

fn load_config() -> SyncConfig {
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
                    // If we're in scripts/sync, go up two levels
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
    let s3_bucket = std::env::var("S3_BUCKET").ok();
    let s3_region = std::env::var("S3_REGION").ok();
    let s3_access_key = std::env::var("S3_ACCESS_KEY_ID").ok();
    let s3_secret_key = std::env::var("S3_SECRET_ACCESS_KEY").ok();
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty());
    let s3_public_url = std::env::var("S3_PUBLIC_URL").ok();

    SyncConfig {
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
// S3 Upload
// ---------------------------------------------------------------------------

async fn create_s3_client(config: &SyncConfig) -> Option<S3Client> {
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
                "dmp-sync"
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
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();

    println!("DMP MusicBrainz Sync");
    println!("====================");
    if args.overwrite {
        println!("Mode      : overwrite (re-sync all artists)");
    }
    println!();

    // Initialize error log
    let error_log = Mutex::new(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("errors.log")
            .expect("Cannot open errors.log"),
    );

    let config = load_config();
    println!("Image storage: {}", config.image_storage);
    println!();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    // Initialize S3 client if needed
    let use_s3 = config.image_storage == "s3" || config.image_storage == "both";
    let s3_client = if use_s3 {
        create_s3_client(&config).await
    } else {
        None
    };

    let mut limiter = RateLimiter::new();
    let start = Instant::now();

    // Image directories
    let artist_img_dir = PathBuf::from(&config.project_root)
        .join("web/public/img/artists");
    fs::create_dir_all(&artist_img_dir).ok();

    // Build artist query with filters
    let mut base_query = if args.overwrite {
        r#"SELECT id, name, slug, "musicbrainzId" FROM "Artist" WHERE 1=1"#.to_string()
    } else {
        r#"SELECT id, name, slug, "musicbrainzId" FROM "Artist" 
           WHERE ("musicbrainzId" IS NULL 
              OR "lastSyncedAt" IS NULL 
              OR "lastSyncedAt" < NOW() - INTERVAL '30 days')"#.to_string()
    };

    // Apply filters
    if let Some(ref prefix) = args.only {
        let pattern = format!("{}%", prefix.to_lowercase());
        base_query.push_str(&format!(" AND LOWER(slug) LIKE '{}'", pattern));
    } else {
        if let Some(ref from) = args.from {
            base_query.push_str(&format!(" AND LOWER(slug) >= '{}'", from.to_lowercase()));
        }
        if let Some(ref to) = args.to {
            base_query.push_str(&format!(" AND LOWER(slug) <= '{}'", to.to_lowercase()));
        }
    }

    base_query.push_str(" ORDER BY slug");

    if args.limit > 0 {
        base_query.push_str(&format!(" LIMIT {}", args.limit));
    }

    let artists: Vec<(String, String, String, Option<String>)> = sqlx::query_as(&base_query)
        .fetch_all(&pool)
        .await
        .expect("Failed to fetch artists");

    // Filter out "Various Artists" (compilation marker)
    let filtered_artists: Vec<_> = artists
        .into_iter()
        .filter(|(_, name, slug, _)| {
            // Skip "Various Artists" and similar compilation markers
            let name_lower = name.to_lowercase();
            !(name_lower == "various artists" 
                || name_lower == "various" 
                || slug == "various-artists"
                || slug == "various")
        })
        .collect();

    println!(
        "Artists to sync: {}",
        filtered_artists.len()
    );
    if filtered_artists.len() > 10 {
        println!("Note: MusicBrainz rate limits apply. Large batches may take time.");
    }
    println!();

    let mut synced = 0u32;
    let mut failed = 0u32;
    let mut partial = 0u32; // Artists synced but with some release failures
    let total = filtered_artists.len() as u32;
    
    // Track failed artists with reasons for final report
    let mut failed_artists: Vec<(String, String)> = Vec::new();

    for (idx, (artist_id, artist_name, artist_slug, existing_mb_id)) in filtered_artists.iter().enumerate() {
        let progress_num = idx + 1;
        println!("\n{} {} {}", 
            format!("[{}/{}]", progress_num, total).bright_blue().bold(),
            "Syncing:".white(),
            artist_name.bright_cyan().bold()
        );

        // 1. Find artist on MusicBrainz
        println!("  {} Searching MusicBrainz...", "→".bright_black());
        let mb_id = if let Some(ref mid) = existing_mb_id {
            println!("    {} Using existing MB ID: {}", "✓".green(), mid.bright_black());
            mid.clone()
        } else {
            match mb_search_artist(&client, artist_name, &mut limiter).await {
                Ok(Some(m)) => {
                    println!("    {} Found: {} ({})", "✓".green(), m.name.bright_white(), m.id.bright_black());
                    // Save MB ID
                    sqlx::query(
                        r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&m.id)
                    .bind(artist_id)
                    .execute(&pool)
                    .await
                    .ok();
                    m.id
                }
                Ok(None) => {
                    println!("    {} No match found", "✗".red());
                    failed_artists.push((artist_name.clone(), "No MusicBrainz match".to_string()));
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[SYNC] No MusicBrainz match for artist: {}", artist_name).ok();
                    }
                    // Mark as synced (update lastSyncedAt) so we don't retry immediately
                    sqlx::query(
                        r#"UPDATE "Artist" SET "lastSyncedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1"#,
                    )
                    .bind(artist_id)
                    .execute(&pool)
                    .await
                    .ok();
                    failed += 1;
                    continue;
                }
                Err(e) => {
                    println!("    {} Error: {}", "✗".red(), e.bright_red());
                    failed_artists.push((artist_name.clone(), format!("Search error: {}", e)));
                    if let Ok(mut f) = error_log.lock() {
                        writeln!(f, "[SYNC] Search error for artist '{}': {}", artist_name, e).ok();
                    }
                    failed += 1;
                    continue;
                }
            }
        };

        // 2. Get artist detail (URLs, genres, tags)
        println!("  {} Fetching artist details...", "→".bright_black());
        match mb_get_artist_detail(&client, &mb_id, &mut limiter).await {
            Ok(detail) => {
                let mut details_count = 0;
                
                // URLs
                if let Some(ref rels) = detail.relations {
                    for rel in rels {
                        if let Some(ref url) = rel.url {
                            upsert_artist_url(&pool, artist_id, &rel.relation_type, &url.resource)
                                .await
                                .ok();
                            details_count += 1;
                        }
                    }
                }

                // Genres from MB
                let mut genre_count = 0;
                if let Some(ref genres) = detail.genres {
                    for g in genres {
                        if g.count.unwrap_or(0) > 0 {
                            if let Ok(genre_id) = ensure_genre(&pool, &g.name).await {
                                link_artist_genre(&pool, artist_id, &genre_id).await.ok();
                                genre_count += 1;
                            }
                        }
                    }
                }

                // Tags as genres (fallback)
                if let Some(ref tags) = detail.tags {
                    for t in tags {
                        if t.count.unwrap_or(0) > 0 {
                            if let Ok(genre_id) = ensure_genre(&pool, &t.name).await {
                                link_artist_genre(&pool, artist_id, &genre_id).await.ok();
                                genre_count += 1;
                            }
                        }
                    }
                }

                println!("    {} Saved {} URLs, {} genres", "✓".green(), details_count, genre_count);

                // Artist image
                print!("  {} Downloading artist image... ", "→".bright_black());
                std::io::Write::flush(&mut std::io::stdout()).ok();
                let img_result =
                    download_artist_image(&client, &detail, artist_slug, &artist_img_dir, &s3_client, &config, &pool, artist_id).await;
                if img_result.is_some() {
                    println!("{}", "✓".green());
                } else {
                    println!("{} (not found)", "✗".yellow());
                }
            }
            Err(e) => {
                println!("    {} Error: {}", "✗".yellow(), e.yellow());
            }
        }

        // 3. Get release groups (discography)
        println!("  {} Fetching releases...", "→".bright_black());
        let release_groups = match mb_get_release_groups(&client, &mb_id, &mut limiter).await {
            Ok(rgs) => {
                println!("    {} Found {} release groups", "✓".green(), rgs.len());
                rgs
            }
            Err(e) => {
                println!("    {} Error: {}", "✗".red(), e.bright_red());
                failed_artists.push((artist_name.clone(), format!("Failed to fetch releases: {}", e)));
                if let Ok(mut f) = error_log.lock() {
                    writeln!(f, "[SYNC] Failed to fetch releases for artist '{}': {}", artist_name, e).ok();
                }
                failed += 1;
                continue;
            }
        };

        let mut release_scores: Vec<f64> = Vec::new();
        let mut release_failures = 0u32;
        let mut skipped_singles = 0u32;
        let mut processed_releases = 0u32;

        for rg in &release_groups {
            if let Some(skip_reason) = should_skip_release(rg) {
                println!("    {} {} ({}) - Skipping ({})", 
                    "↷".bright_black(),
                    rg.title.bright_black(), 
                    rg.primary_type.as_deref().unwrap_or("Album").bright_black(),
                    skip_reason.yellow()
                );
                skipped_singles += 1;
                continue;
            }

            processed_releases += 1;
            print!("    {} {} ({})... ", 
                "→".bright_black(),
                rg.title.bright_white(), 
                rg.primary_type.as_deref().unwrap_or("Album").bright_black()
            );
            std::io::Write::flush(&mut std::io::stdout()).ok();

            let release_type = rg.primary_type.as_deref().unwrap_or("Album");
            let year = rg
                .first_release_date
                .as_ref()
                .and_then(|d| d.split('-').next())
                .and_then(|y| y.parse::<i32>().ok());

            let type_id = match ensure_release_type(&pool, release_type).await {
                Ok(id) => id,
                Err(_) => continue,
            };

            // Upsert MB release
            let mb_release_id =
                match upsert_mb_release(&pool, artist_id, &rg.title, &type_id, year, &rg.id).await
                {
                    Ok(id) => id,
                    Err(e) => {
                        eprintln!(
                            "\n  ⚠ Release '{}' by '{}': DB error - {}",
                            rg.title, artist_name, e
                        );
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[SYNC] DB error inserting release '{}' for artist '{}': {}", rg.title, artist_name, e).ok();
                        }
                        release_failures += 1;
                        continue;
                    }
                };

            // Get tracks for this release group
            let release_tracks =
                match mb_get_release_tracks(&client, &rg.id, &mut limiter).await {
                    Ok(rt) => {
                        println!("{}", "✓".green());
                        rt
                    }
                    Err(e) => {
                        // mb_get already retried 10 times with exponential backoff
                        // If we still failed, log it and move on
                        println!("{} {}", "✗".red(), e.yellow());
                        release_failures += 1;
                        
                        if let Ok(mut f) = error_log.lock() {
                            writeln!(f, "[SYNC] Failed to fetch tracks for release '{}' by '{}': {}", rg.title, artist_name, e).ok();
                        }
                        
                        // If the error suggests we should stop entirely, break
                        if e.contains("still unavailable after") {
                            println!("    {} Stopping sync for '{}' due to persistent rate limiting", 
                                "⚠".yellow(), artist_name.yellow());
                            failed_artists.push((artist_name.clone(), "Persistent rate limiting".to_string()));
                            break;
                        }
                        continue;
                    }
                };

            // Use the first (most canonical) release's tracks
            if let Some((_, tracks)) = release_tracks.first() {
                // Delete existing tracks for this MB release, then insert fresh
                delete_mb_tracks_for_release(&pool, &mb_release_id).await.ok();

                let mut mb_track_pairs: Vec<(String, Option<i32>)> = Vec::new();
                let disc_num = 1i32;

                for track in tracks {
                    let pos = track.position.map(|p| p as i32);
                    let dur_ms = track.length.map(|l| l as i32);

                    upsert_mb_track(
                        &pool,
                        &mb_release_id,
                        &track.title,
                        pos,
                        Some(disc_num),
                        dur_ms,
                        &track.id,
                    )
                    .await
                    .ok();

                    mb_track_pairs.push((track.title.clone(), pos));
                }

                // Status check
                let (status, _missing, _extra, score) = match check_release_status(
                    &pool,
                    artist_id,
                    &mb_release_id,
                    &rg.title,
                    &mb_track_pairs,
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => (MatchStatus::Unknown, None, None, 0.0),
                };

                // Update MB release status (just the status, not the track arrays)
                let now = Utc::now().naive_utc();
                sqlx::query(
                    r#"UPDATE "musicbrainz_releases" SET
                         status = $1::"ReleaseStatus",
                         "updatedAt" = $2
                       WHERE id = $3"#,
                )
                .bind(status.as_str())
                .bind(now)
                .bind(&mb_release_id)
                .execute(&pool)
                .await
                .ok();

                // Also update LocalRelease matchStatus if linked
                sqlx::query(
                    r#"UPDATE "LocalRelease" SET
                         "matchStatus" = $1::"ReleaseStatus",
                         "updatedAt" = NOW()
                       WHERE "releaseId" = $2"#,
                )
                .bind(status.as_str())
                .bind(&mb_release_id)
                .execute(&pool)
                .await
                .ok();

                release_scores.push(score);
            }
        }

        // Summary for this artist
        println!("  {} Processed {} releases ({} skipped, {} failed)", 
            "→".bright_black(),
            processed_releases, 
            skipped_singles,
            release_failures
        );

        // Update artist - mark as synced even if all releases were skipped
        let now = Utc::now().naive_utc();
        
        // If we got ANY scores OR just had skipped releases (no failures), mark as synced
        let all_processed = release_scores.len() > 0 || (processed_releases == 0 && release_failures == 0);
        
        if all_processed {
            let avg_score = if release_scores.is_empty() {
                None // No releases processed = no score
            } else {
                Some(release_scores.iter().sum::<f64>() / release_scores.len() as f64)
            };
            
            sqlx::query(
                r#"UPDATE "Artist" SET
                     "averageMatchScore" = $1,
                     "lastSyncedAt" = $2,
                     "updatedAt" = $2
                   WHERE id = $3"#,
            )
            .bind(avg_score)
            .bind(now)
            .bind(artist_id)
            .execute(&pool)
            .await
            .ok();
        } else {
            // Just update timestamp (will be retried in 30 days)
            sqlx::query(
                r#"UPDATE "Artist" SET
                     "lastSyncedAt" = $1,
                     "updatedAt" = $1
                   WHERE id = $2"#,
            )
            .bind(now)
            .bind(artist_id)
            .execute(&pool)
            .await
            .ok();
            
            failed += 1;
            failed_artists.push((artist_name.clone(), "Could not process any releases (errors occurred)".to_string()));
            if let Ok(mut f) = error_log.lock() {
                writeln!(f, "[SYNC] Artist '{}' could not process any releases (errors occurred)", artist_name).ok();
            }
        }

        // Track if this was a partial success
        if release_failures > 0 && all_processed {
            partial += 1;
            println!("  {} Partially synced ({} releases had issues)", "⚠".yellow(), release_failures);
        } else if all_processed {
            synced += 1;
            if processed_releases == 0 && skipped_singles > 0 {
                println!("  {} Synced (all releases were Singles/filtered types)", "✓".green().bold());
            } else {
                println!("  {} Fully synced", "✓".green().bold());
            }
        } else {
            println!("  {} Failed to sync", "✗".red().bold());
        }
    }

    // Update statistics
    update_statistics(&pool).await.ok();

    let elapsed = start.elapsed();
    println!();
    println!("{}", "═".repeat(60).bright_black());
    println!();
    println!("{} {:.1}s", "Completed in:".white().bold(), elapsed.as_secs_f64());
    println!("  {} {}", "Synced:".green(), synced);
    if partial > 0 {
        println!("  {} {} (some releases had issues)", "Partial:".yellow(), partial);
    }
    if failed > 0 {
        println!("  {} {}", "Failed:".red(), failed);
    }
    println!("  {} {}", "Total:".white(), total);
    
    // Show detailed failure list
    if !failed_artists.is_empty() {
        println!();
        println!("{}", "Failed Artists:".red().bold());
        for (name, reason) in &failed_artists {
            println!("  {} {} - {}", "✗".red(), name.bright_white(), reason.bright_black());
        }
    }
    
    if partial > 0 || failed > 0 {
        println!();
        println!("{} Run {} again to retry.", 
            "Tip:".yellow().bold(), 
            "./sync".bright_cyan()
        );
    }
}
