use reqwest::Client;
use std::time::{Duration, Instant, SystemTime};
use tokio::time::sleep;

use crate::mb_types::*;

pub const MB_BASE: &str = "https://musicbrainz.org/ws/2";
pub const USER_AGENT: &str = "DMPv6/0.1.0 ( https://github.com/dmp )";

// ---------------------------------------------------------------------------
// Adaptive rate limiter
// ---------------------------------------------------------------------------

pub struct RateLimiter {
    delay_ms: u64,
    min_delay: u64,
    max_delay: u64,
    last_request: Instant,
    remaining: Option<u64>,
    reset_at: Option<u64>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            delay_ms: 1100,
            min_delay: 1100,
            max_delay: 10000,
            last_request: Instant::now(),
            remaining: None,
            reset_at: None,
        }
    }

    pub fn set_web(&mut self, _web: bool) {}

    pub async fn wait(&mut self) {
        let effective = self.effective_delay();
        let elapsed = self.last_request.elapsed().as_millis() as u64;
        if elapsed < effective {
            sleep(Duration::from_millis(effective - elapsed)).await;
        }
        self.last_request = Instant::now();
    }

    fn effective_delay(&self) -> u64 {
        if let (Some(remaining), Some(reset_at)) = (self.remaining, self.reset_at) {
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let secs_left = reset_at.saturating_sub(now).max(1);
            if remaining <= 10 {
                return self.max_delay.min(secs_left * 1000 / 2);
            }
            let ideal = (secs_left * 1000) / (remaining * 80 / 100).max(1);
            return ideal.max(self.min_delay).min(self.delay_ms);
        }
        self.delay_ms
    }

    fn update_from_headers(&mut self, remaining: Option<u64>, reset_at: Option<u64>) {
        self.remaining = remaining;
        self.reset_at = reset_at;
    }

    fn on_success(&mut self) {
        if self.delay_ms > self.min_delay {
            self.delay_ms = (self.delay_ms * 85 / 100).max(self.min_delay);
        }
    }

    fn on_rate_limit(&mut self) {
        self.delay_ms = (self.delay_ms * 2).min(self.max_delay);
        self.remaining = None;
        self.reset_at = None;
    }
}

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

pub async fn mb_get(
    client: &Client,
    url: &str,
    limiter: &mut RateLimiter,
) -> Result<String, String> {
    let max_attempts = 6;
    let mut wait_time: u64 = 1000;

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

        let rl_remaining = resp
            .headers()
            .get("X-RateLimit-Remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        let rl_reset = resp
            .headers()
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        limiter.update_from_headers(rl_remaining, rl_reset);

        if status == 200 {
            limiter.on_success();
            return resp
                .text()
                .await
                .map_err(|e| format!("Read body failed: {}", e));
        }

        if status == 503 || status == 429 {
            limiter.on_rate_limit();
            if attempt < max_attempts - 1 {
                wait_time = (wait_time * 2).min(16000);
                let reason = if status == 503 {
                    "Waiting for MusicBrainz"
                } else {
                    "Rate limited"
                };
                eprintln!(
                    "      ⚠ HTTP {} - {} - waiting {:.1}s before next attempt ({}/{}) [delay_ms={}]",
                    status,
                    reason,
                    wait_time as f64 / 1000.0,
                    attempt + 1,
                    max_attempts - 1,
                    limiter.delay_ms,
                );
                sleep(Duration::from_millis(wait_time)).await;
                continue;
            } else {
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

// ---------------------------------------------------------------------------
// Artist search / lookup
// ---------------------------------------------------------------------------

pub async fn mb_search_artist(
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

    use crate::mb_matching::names_are_similar;
    Ok(result
        .artists
        .into_iter()
        .find(|a| a.score.unwrap_or(0) >= 90 && names_are_similar(name, &a.name)))
}

pub async fn mb_lookup_artist(
    client: &Client,
    mb_artist_id: &str,
    limiter: &mut RateLimiter,
) -> Result<MbArtistMatch, String> {
    let url = format!("{}/artist/{}?fmt=json", MB_BASE, mb_artist_id);
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ArtistLookup {
        id: String,
        name: String,
    }
    let a: ArtistLookup =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(MbArtistMatch {
        id: a.id,
        name: a.name,
        score: Some(100),
    })
}

pub async fn mb_lookup_release_group_artist(
    client: &Client,
    mb_release_group_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbArtistMatch>, String> {
    let url = format!(
        "{}/release-group/{}?inc=artist-credits&fmt=json",
        MB_BASE, mb_release_group_id
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ArtistRef {
        id: String,
        name: String,
    }
    #[derive(serde::Deserialize)]
    struct ArtistCredit {
        artist: ArtistRef,
    }
    #[derive(serde::Deserialize)]
    struct RgLookup {
        #[serde(rename = "artist-credit")]
        artist_credit: Option<Vec<ArtistCredit>>,
    }

    let rg: RgLookup =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(rg
        .artist_credit
        .unwrap_or_default()
        .into_iter()
        .map(|ac| MbArtistMatch {
            id: ac.artist.id,
            name: ac.artist.name,
            score: Some(100),
        })
        .collect())
}

pub async fn mb_search_release_group_credits(
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
    let url = format!(
        "{}/release-group/?query={}&limit=1&fmt=json",
        MB_BASE, encoded
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ArtistRef {
        id: String,
        name: String,
    }
    #[derive(serde::Deserialize)]
    struct ArtistCredit {
        artist: ArtistRef,
    }
    #[derive(serde::Deserialize)]
    struct RgResult {
        #[serde(rename = "artist-credit")]
        artist_credit: Option<Vec<ArtistCredit>>,
        score: Option<u32>,
    }
    #[derive(serde::Deserialize)]
    struct SearchResult {
        #[serde(rename = "release-groups")]
        release_groups: Option<Vec<RgResult>>,
    }

    let result: SearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    let rgs = result.release_groups.unwrap_or_default();
    if let Some(rg) = rgs.into_iter().next() {
        if rg.score.unwrap_or(0) >= 80 {
            return Ok(rg
                .artist_credit
                .unwrap_or_default()
                .into_iter()
                .map(|ac| MbArtistMatch {
                    id: ac.artist.id,
                    name: ac.artist.name,
                    score: Some(100),
                })
                .collect());
        }
    }
    Ok(Vec::new())
}

pub async fn mb_get_artist_detail(
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

pub async fn mb_get_release_groups(
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

pub async fn mb_get_release_tracks(
    client: &Client,
    release_group_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<(MbRelease, Vec<MbTrack>)>, String> {
    let limit = 100u32;
    let mut offset = 0u32;
    let mut all_releases: Vec<MbRelease> = Vec::new();
    loop {
        let url = format!(
            "{}/release?release-group={}&inc=recordings&limit={}&offset={}&fmt=json",
            MB_BASE, release_group_id, limit, offset
        );
        let body = mb_get(client, &url, limiter).await?;
        let result: MbReleaseList =
            serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
        let batch_len = result.releases.len() as u32;
        all_releases.extend(result.releases);
        if batch_len < limit {
            break;
        }
        offset += limit;
    }

    let mut releases = Vec::new();
    for release in all_releases {
        if let Some(ref status) = release.status {
            if !status.eq_ignore_ascii_case("Official") {
                continue;
            }
        }
        let mut tracks = Vec::new();
        if let Some(ref media) = release.media {
            for medium in media {
                if let Some(ref trks) = medium.tracks {
                    for trk in trks {
                        let mut t = trk.clone();
                        t.disc_number = medium.position;
                        tracks.push(t);
                    }
                }
            }
        }
        releases.push((release, tracks));
    }

    Ok(releases)
}

pub async fn mb_get_release_by_id(
    client: &Client,
    release_id: &str,
    limiter: &mut RateLimiter,
) -> Result<(MbRelease, Vec<MbTrack>, String), String> {
    let url = format!(
        "{}/release/{}?inc=recordings+release-groups&fmt=json",
        MB_BASE, release_id
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ReleaseGroupRef {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct ReleaseLookup {
        #[serde(flatten)]
        release: MbRelease,
        #[serde(rename = "release-group")]
        release_group: Option<ReleaseGroupRef>,
    }

    let lookup: ReleaseLookup =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    let rg_id = lookup
        .release_group
        .map(|rg| rg.id)
        .unwrap_or_default();

    let mut tracks = Vec::new();
    if let Some(ref media) = lookup.release.media {
        for medium in media {
            if let Some(ref trks) = medium.tracks {
                for trk in trks {
                    let mut t = trk.clone();
                    t.disc_number = medium.position;
                    tracks.push(t);
                }
            }
        }
    }

    Ok((lookup.release, tracks, rg_id))
}
