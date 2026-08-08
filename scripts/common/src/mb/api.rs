use crate::error_log;
use reqwest::Client;
use std::time::{Duration, Instant, SystemTime};
use tokio::time::sleep;

use super::names::{mb_artist_exact, names_are_similar};
use super::types::*;

pub const MB_BASE: &str = "https://musicbrainz.org/ws/2";
pub const USER_AGENT: &str = "DMPv6/0.1.0 ( https://github.com/dmp )";

/// Escape a value for use inside a **quoted** Lucene phrase (`field:"…"`), which is how every
/// search query here is built.
///
/// Only `\` and `"` matter inside a quoted phrase - the other Lucene metacharacters (`+ - && || !
/// ( ) { } [ ] ^ ~ * ? :`) are literal there, so escaping them would corrupt real names like
/// `AC/DC` or `Sunn O)))`. Backslash must be escaped first, or the backslashes introduced when
/// escaping the quotes would themselves be doubled.
///
/// Without this, an artist whose name carries a nickname in quotes - `Lee "Scratch" Perry`,
/// `Bonnie "Prince" Billy`, `"Weird Al" Yankovic`, and 176 others in a real library - closes the
/// phrase early. MusicBrainz's parser tolerates the broken syntax rather than rejecting it (still
/// HTTP 200), but it degrades into a noisy multi-term match: `artist:"Lee "Scratch" Perry"` returns
/// five candidates (Perry Como, Katy Perry, Perry Rhodan among them) instead of the one clean hit
/// `artist:"Lee \"Scratch\" Perry"` gives. That noise is exactly what the PERFECT-match-only
/// resolvers here are built to distrust, so the unescaped query was quietly starving correct tags of
/// a match rather than hard-failing on them. The tags are correct; the query was not.
pub fn escape_lucene_phrase(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

// ---------------------------------------------------------------------------
// Adaptive rate limiter
// ---------------------------------------------------------------------------

/// MusicBrainz allows roughly one request per second per client. 1100ms was the old floor and is kept
/// as the hard lower bound for `MB_MIN_DELAY_MS`; the default sits slightly above it so ordinary clock
/// jitter doesn't push a run over the line and earn a 503 that then costs minutes to recover from.
const MIN_DELAY_FLOOR_MS: u64 = 1100;
const DEFAULT_MIN_DELAY_MS: u64 = 1300;
const MAX_DELAY_MS: u64 = 10000;

/// Recovery is additive, not multiplicative. A 15% cut per success walked the delay back to the floor
/// in ~14 requests, which is fast enough to slam straight back into the wall - the observed pattern of
/// 503s arriving in clusters. Shedding a fixed 100ms per success drains a spike gradually instead.
const RECOVERY_STEP_MS: u64 = 100;

/// `MB_MIN_DELAY_MS` overrides the pacing floor for a run without a rebuild - useful when MusicBrainz
/// is having a bad day and the only lever left is going slower. Clamped, because a floor below MB's
/// published rate is not a knob anyone should be able to turn.
fn configured_min_delay() -> u64 {
    std::env::var("MB_MIN_DELAY_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|v| v.clamp(MIN_DELAY_FLOOR_MS, MAX_DELAY_MS))
        .unwrap_or(DEFAULT_MIN_DELAY_MS)
}

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
        let min_delay = configured_min_delay();
        Self {
            delay_ms: min_delay,
            min_delay,
            max_delay: MAX_DELAY_MS,
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
            self.delay_ms = self
                .delay_ms
                .saturating_sub(RECOVERY_STEP_MS)
                .max(self.min_delay);
        }
    }

    fn on_rate_limit(&mut self) {
        self.delay_ms = (self.delay_ms * 2).min(self.max_delay);
        self.remaining = None;
        self.reset_at = None;
    }
}

// ---------------------------------------------------------------------------
// Throttle classification
// ---------------------------------------------------------------------------

/// Why MusicBrainz refused a request.
///
/// 503 covers two unrelated situations - "you are going too fast" and "our servers are struggling" -
/// and they want opposite responses. Pacing down fixes the first and does nothing for the second, so
/// treating every 503 as a rate limit permanently slows a run because MB had a bad minute. With 56k
/// names to resolve that is the difference between a ~17h pass at the floor and a ~157h one at the cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThrottleKind {
    /// We are over the allowance - back the pacing off.
    RateLimited,
    /// MusicBrainz itself is unwell - retry, but do not slow the steady-state pace.
    Overloaded,
}

pub fn classify_throttle(status: u16, remaining: Option<u64>, body: &str) -> ThrottleKind {
    if status == 429 || remaining == Some(0) {
        return ThrottleKind::RateLimited;
    }
    if body.to_lowercase().contains("rate limit") {
        ThrottleKind::RateLimited
    } else {
        ThrottleKind::Overloaded
    }
}

/// `Retry-After` in its delta-seconds form, as milliseconds.
///
/// The HTTP-date variant is not parsed: MusicBrainz doesn't send it, and a date we failed to read must
/// never collapse into a 0ms wait - anything unparseable yields `None` so the caller keeps its own
/// backoff ladder. Clamped to 1..=60s so a hostile or mistaken header can't stall a run for an hour.
fn parse_retry_after(raw: Option<&str>) -> Option<u64> {
    let secs = raw?.trim().parse::<u64>().ok()?;
    Some(secs.clamp(1, 60) * 1000)
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/// Every mb_api function returns `Result<T, String>` (see mb_get below) - this is the single place
/// that classifies what those error strings actually mean, instead of scattering `.contains("503")`
/// checks at every call site. Previously a `Request failed: ...` (reqwest-level network/timeout/DNS
/// error from mb_get's `.send()`) matched NONE of the "transient" checks and fell through to the
/// hard-fail branch - in the `--release <id>` merge-validation path that feeds the file-deleting
/// INVALID path on a plain network blip, not a genuine no-match (see docs audit #3/#63).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MbErrorKind {
    /// HTTP 404 - this specific ID doesn't exist; try the next lookup tier.
    NotFound,
    /// Network/timeout/DNS error, or MB itself reporting overload (503/429, retries exhausted).
    /// Worth skipping for now and retrying later - NOT evidence the release has no MB match.
    Transient,
    /// Anything else (unexpected status, response parse failure).
    Hard,
}

pub fn classify_mb_error(e: &str) -> MbErrorKind {
    if e.contains("HTTP 404") {
        MbErrorKind::NotFound
    } else if e.starts_with("Request failed:")
        || e.starts_with("Read body failed:")
        || e.contains("unavailable")
        || e.contains("503")
        || e.contains("429")
    {
        MbErrorKind::Transient
    } else {
        MbErrorKind::Hard
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
    let mut ladder: u64 = 1000;
    // The pacing penalty is applied at most once per call. Previously every retry inside a single
    // mb_get doubled delay_ms, so one unlucky name walked the limiter 1100 -> 2200 -> 4400 -> 8800 ->
    // 10000 and pinned every *later* name at the cap until enough successes had drained it. The
    // per-attempt backoff below still escalates - only the steady-state pace is spared.
    let mut penalised = false;

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
        let retry_after = parse_retry_after(
            resp.headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok()),
        );
        limiter.update_from_headers(rl_remaining, rl_reset);

        if status == 200 {
            limiter.on_success();
            return resp
                .text()
                .await
                .map_err(|e| format!("Read body failed: {}", e));
        }

        if status == 503 || status == 429 {
            // The body is what separates MB's rate-limit 503 from a plain overload 503. It is small,
            // and this branch is already the slow path, so reading it costs nothing that matters.
            let body = resp.text().await.unwrap_or_default();
            let kind = classify_throttle(status, rl_remaining, &body);
            if kind == ThrottleKind::RateLimited && !penalised {
                limiter.on_rate_limit();
                penalised = true;
            }
            if attempt < max_attempts - 1 {
                ladder = (ladder * 2).min(16000);
                // MB's own advice wins over our guess when it bothers to give one.
                let wait_time = retry_after.unwrap_or(ladder);
                let reason = match kind {
                    ThrottleKind::RateLimited => "rate-limit",
                    ThrottleKind::Overloaded => "server overload",
                };
                error_log::log_warn(&format!(
                    "HTTP {} ({}) (attempt {}/{})",
                    status,
                    reason,
                    attempt + 1,
                    max_attempts - 1
                ));
                eprintln!(
                    "      ⚠ HTTP {} ({}) - waiting {:.1}s before next attempt ({}/{}) [delay_ms={}]",
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
                    ladder / 1000
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

async fn mb_artist_candidates(
    client: &Client,
    name: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbArtistMatch>, String> {
    let phrase = format!("\"{}\"", escape_lucene_phrase(name));
    let quoted = urlencoding::encode(&phrase);
    let url = format!(
        "{}/artist/?query=artist:{}&limit=5&fmt=json",
        MB_BASE, quoted
    );
    let body = mb_get(client, &url, limiter).await?;
    let result: MbArtistSearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(result.artists)
}

/// Fuzzy artist search - accepts a candidate whose name merely *overlaps* the query
/// (`names_are_similar`, Jaccard >= 0.5). Used by sync's release matching, where the query is already
/// known to be a single artist and the goal is to survive spelling/punctuation drift.
///
/// NOT suitable for deciding whether a compound tag is one artist or several: `names_are_similar`
/// treats "with"/"&" as noise words, so "Frank Sinatra with Count Basie" vs "Frank Sinatra" scores
/// exactly 0.5 and passes - which would confirm nearly every compound string as a single artist. The
/// resolver uses `mb_search_artist_exact` for that.
pub async fn mb_search_artist(
    client: &Client,
    name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    Ok(mb_artist_candidates(client, name, limiter)
        .await?
        .into_iter()
        .find(|a| a.score.unwrap_or(0) >= 90 && names_are_similar(name, &a.name)))
}

/// Strict artist search - a candidate only counts when the queried string *is* that artist:
/// normalized equality against the MB name or one of its aliases, at score >= 90. This is the
/// question the resolver actually asks ("is this whole string a real artist?"), so partial-overlap
/// matches must not qualify.
pub async fn mb_search_artist_exact(
    client: &Client,
    name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    let phrase = format!("\"{}\"", escape_lucene_phrase(name));
    let quoted = urlencoding::encode(&phrase);
    let url = format!(
        "{}/artist/?query=artist:{}&limit=5&inc=aliases&fmt=json",
        MB_BASE, quoted
    );
    let body = mb_get(client, &url, limiter).await?;
    let result: MbArtistSearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    Ok(result
        .artists
        .into_iter()
        .find(|a| a.score.unwrap_or(0) >= 90 && mb_artist_exact(name, a)))
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
    let a: ArtistLookup = serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(MbArtistMatch {
        id: a.id,
        name: a.name,
        score: Some(100),
        aliases: None,
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

    let rg: RgLookup = serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(rg
        .artist_credit
        .unwrap_or_default()
        .into_iter()
        .map(|ac| MbArtistMatch {
            id: ac.artist.id,
            name: ac.artist.name,
            score: Some(100),
            aliases: None,
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
        escape_lucene_phrase(album_title),
        escape_lucene_phrase(artist_name),
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
                    aliases: None,
                })
                .collect());
        }
    }
    Ok(Vec::new())
}

/// A release-group found by a title+artist search: the id (to browse its editions), its title (to
/// re-verify the match against the local album), its primary/secondary types (for the allow-list),
/// and the artist-credit names (to re-verify the artist independently of the search query's own
/// fuzzy `AND artist:"..."` clause).
pub struct SearchedReleaseGroup {
    pub id: String,
    pub title: String,
    pub primary_type: Option<String>,
    pub secondary_types: Vec<String>,
    pub score: u32,
    pub artist_credit: Vec<String>,
    /// The release-group's own release year (earliest release in the group) - what MusicBrainz
    /// itself shows as "Year" for this release-group, independent of which specific edition a
    /// caller later looks up. `None` for a handful of legitimately dateless entries.
    pub first_release_date: Option<String>,
}

/// Search MusicBrainz for a release group by album title + artist. Used only as a last-resort fallback
/// when a local release carries no usable embedded MB id (e.g. a compilation whose tracks are tagged
/// with their original sources). The caller re-verifies the returned title and gates on the allow-list
/// before binding, so this only proposes a candidate - it never binds on its own.
pub async fn mb_search_release_group(
    client: &Client,
    album_title: &str,
    artist_name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<SearchedReleaseGroup>, String> {
    let query = format!(
        "releasegroup:\"{}\" AND artist:\"{}\"",
        escape_lucene_phrase(album_title),
        escape_lucene_phrase(artist_name),
    );
    let encoded = urlencoding::encode(&query);
    let url = format!(
        "{}/release-group/?query={}&limit=3&fmt=json",
        MB_BASE, encoded
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ArtistRef {
        name: String,
    }
    #[derive(serde::Deserialize)]
    struct ArtistCredit {
        artist: ArtistRef,
    }
    #[derive(serde::Deserialize)]
    struct RgResult {
        id: String,
        title: String,
        #[serde(rename = "primary-type")]
        primary_type: Option<String>,
        #[serde(rename = "secondary-types")]
        secondary_types: Option<Vec<String>>,
        score: Option<u32>,
        #[serde(rename = "artist-credit")]
        artist_credit: Option<Vec<ArtistCredit>>,
        #[serde(rename = "first-release-date")]
        first_release_date: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct SearchResult {
        #[serde(rename = "release-groups")]
        release_groups: Option<Vec<RgResult>>,
    }

    let result: SearchResult =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(result
        .release_groups
        .unwrap_or_default()
        .into_iter()
        .next()
        .map(|rg| SearchedReleaseGroup {
            id: rg.id,
            title: rg.title,
            primary_type: rg.primary_type,
            secondary_types: rg.secondary_types.unwrap_or_default(),
            score: rg.score.unwrap_or(0),
            artist_credit: rg
                .artist_credit
                .unwrap_or_default()
                .into_iter()
                .map(|ac| ac.artist.name)
                .collect(),
            first_release_date: rg.first_release_date,
        }))
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

/// The result of a Tier-1 release-by-id lookup. `primary_type` / `secondary_types` come from the
/// release's own inline release-group (via `inc=release-groups`), so the allow-list can gate the
/// exact group this release belongs to - authoritative even for compilations whose group is not in
/// the local artist's browsed release-group list.
pub struct ReleaseById {
    pub release: MbRelease,
    pub tracks: Vec<MbTrack>,
    pub rg_id: String,
    pub primary_type: Option<String>,
    pub secondary_types: Vec<String>,
}

pub async fn mb_get_release_by_id(
    client: &Client,
    release_id: &str,
    limiter: &mut RateLimiter,
) -> Result<ReleaseById, String> {
    let url = format!(
        "{}/release/{}?inc=recordings+release-groups&fmt=json",
        MB_BASE, release_id
    );
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ReleaseGroupRef {
        id: String,
        #[serde(rename = "primary-type")]
        primary_type: Option<String>,
        #[serde(rename = "secondary-types")]
        secondary_types: Option<Vec<String>>,
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

    let (rg_id, primary_type, secondary_types) = match lookup.release_group {
        Some(rg) => (
            rg.id,
            rg.primary_type,
            rg.secondary_types.unwrap_or_default(),
        ),
        None => (String::new(), None, Vec::new()),
    };

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

    Ok(ReleaseById {
        release: lookup.release,
        tracks,
        rg_id,
        primary_type,
        secondary_types,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real 503 body MusicBrainz serves when a client is over its allowance.
    const RATE_LIMIT_BODY: &str =
        r#"{"error":"Your requests are exceeding the allowable rate limit. Please see http://wiki.musicbrainz.org/XMLWebService for more information."}"#;

    /// Built field-by-field rather than via `RateLimiter::new()` on purpose: `new()` reads
    /// `MB_MIN_DELAY_MS`, and cargo runs these tests in parallel with the one that mutates it.
    fn limiter_at(delay_ms: u64) -> RateLimiter {
        RateLimiter {
            delay_ms,
            min_delay: DEFAULT_MIN_DELAY_MS,
            max_delay: MAX_DELAY_MS,
            last_request: Instant::now(),
            remaining: None,
            reset_at: None,
        }
    }

    #[test]
    fn recovery_is_additive_and_floors_at_min_delay() {
        let mut l = limiter_at(5000);
        l.on_success();
        assert_eq!(l.delay_ms, 4900, "one success sheds exactly RECOVERY_STEP_MS");
        let floor = l.min_delay;
        let mut l = limiter_at(floor + 50);
        l.on_success();
        assert_eq!(l.delay_ms, floor, "recovery never undercuts the floor");
        l.on_success();
        assert_eq!(l.delay_ms, floor, "already at the floor is a no-op");
    }

    #[test]
    fn rate_limit_doubles_and_caps() {
        let mut l = limiter_at(4000);
        l.on_rate_limit();
        assert_eq!(l.delay_ms, 8000);
        l.on_rate_limit();
        assert_eq!(l.delay_ms, MAX_DELAY_MS, "capped, not 16000");
    }

    #[test]
    fn a_single_call_penalises_the_pace_at_most_once() {
        // Mirrors mb_get's `penalised` latch: five retries of one unlucky name must cost one doubling,
        // not five. Before this, one bad name pinned every later name at the 10s cap.
        let mut l = limiter_at(1300);
        let mut penalised = false;
        for _ in 0..5 {
            let kind = classify_throttle(503, None, RATE_LIMIT_BODY);
            if kind == ThrottleKind::RateLimited && !penalised {
                l.on_rate_limit();
                penalised = true;
            }
        }
        assert_eq!(l.delay_ms, 2600);
    }

    #[test]
    fn rate_limit_body_and_429_and_exhausted_budget_are_rate_limited() {
        assert_eq!(
            classify_throttle(503, None, RATE_LIMIT_BODY),
            ThrottleKind::RateLimited
        );
        assert_eq!(classify_throttle(429, None, ""), ThrottleKind::RateLimited);
        assert_eq!(
            classify_throttle(503, Some(0), "<html>Service Unavailable</html>"),
            ThrottleKind::RateLimited,
            "an empty X-RateLimit-Remaining budget is a rate limit whatever the body says"
        );
    }

    #[test]
    fn bare_503_is_overload_not_rate_limit() {
        // The whole point of the split: slowing down does not fix MusicBrainz being unwell.
        assert_eq!(
            classify_throttle(503, None, "<html><body>503 Service Unavailable</body></html>"),
            ThrottleKind::Overloaded
        );
        assert_eq!(classify_throttle(503, Some(42), ""), ThrottleKind::Overloaded);
    }

    #[test]
    fn retry_after_is_parsed_clamped_and_never_zero() {
        assert_eq!(parse_retry_after(Some("30")), Some(30_000));
        assert_eq!(parse_retry_after(Some("  5 ")), Some(5_000));
        assert_eq!(parse_retry_after(Some("0")), Some(1_000), "clamped up");
        assert_eq!(parse_retry_after(Some("9999")), Some(60_000), "clamped down");
        // HTTP-date form is deliberately unparsed - falling back to the caller's ladder beats a 0ms wait.
        assert_eq!(parse_retry_after(Some("Wed, 21 Oct 2015 07:28:00 GMT")), None);
        assert_eq!(parse_retry_after(None), None);
    }

    #[test]
    fn min_delay_env_override_is_clamped() {
        // Serialised implicitly: these tests share the process env, so set/remove around each assert.
        std::env::set_var("MB_MIN_DELAY_MS", "2000");
        assert_eq!(configured_min_delay(), 2000);
        std::env::set_var("MB_MIN_DELAY_MS", "10");
        assert_eq!(configured_min_delay(), MIN_DELAY_FLOOR_MS, "never below MB's rate");
        std::env::set_var("MB_MIN_DELAY_MS", "999999");
        assert_eq!(configured_min_delay(), MAX_DELAY_MS);
        std::env::set_var("MB_MIN_DELAY_MS", "not-a-number");
        assert_eq!(configured_min_delay(), DEFAULT_MIN_DELAY_MS);
        std::env::remove_var("MB_MIN_DELAY_MS");
        assert_eq!(configured_min_delay(), DEFAULT_MIN_DELAY_MS);
    }

    #[test]
    fn classifies_http_404_as_not_found() {
        assert_eq!(
            classify_mb_error("HTTP 404 for https://musicbrainz.org/..."),
            MbErrorKind::NotFound
        );
    }

    #[test]
    fn classifies_rate_limit_and_unavailable_as_transient() {
        assert_eq!(
            classify_mb_error("MusicBrainz API still unavailable after 6 retries (waited up to 16s). Will retry this release next time."),
            MbErrorKind::Transient,
        );
        assert_eq!(
            classify_mb_error("HTTP 503 for https://musicbrainz.org/..."),
            MbErrorKind::Transient
        );
        assert_eq!(
            classify_mb_error("HTTP 429 for https://musicbrainz.org/..."),
            MbErrorKind::Transient
        );
    }

    #[test]
    fn classifies_network_timeout_dns_errors_as_transient_not_hard() {
        // The actual bug (docs audit #63): a reqwest-level failure (timeout, DNS, connection refused)
        // previously matched none of the "transient" substring checks and fell through to Hard, wrongly
        // counting a network blip as a real failure.
        assert_eq!(
            classify_mb_error("Request failed: error sending request for url (https://musicbrainz.org/...): operation timed out"),
            MbErrorKind::Transient,
        );
        assert_eq!(
            classify_mb_error("Request failed: dns error: failed to lookup address information"),
            MbErrorKind::Transient,
        );
        assert_eq!(
            classify_mb_error("Read body failed: error decoding response body"),
            MbErrorKind::Transient
        );
    }

    #[test]
    fn classifies_everything_else_as_hard() {
        assert_eq!(
            classify_mb_error("Parse error: invalid JSON"),
            MbErrorKind::Hard
        );
        assert_eq!(
            classify_mb_error("HTTP 500 for https://musicbrainz.org/..."),
            MbErrorKind::Hard
        );
    }

    #[test]
    fn escapes_names_that_used_to_produce_noisy_multi_candidate_matches() {
        // Real library values. Each closes the quoted phrase early unescaped.
        assert_eq!(
            escape_lucene_phrase(r#"Lee "Scratch" Perry"#),
            r#"Lee \"Scratch\" Perry"#
        );
        assert_eq!(
            escape_lucene_phrase(r#""Weird Al" Yankovic"#),
            r#"\"Weird Al\" Yankovic"#
        );
    }

    #[test]
    fn escapes_backslashes_before_quotes() {
        // Order matters: escaping quotes first would then double the backslashes this introduces.
        assert_eq!(escape_lucene_phrase(r"AC\"), r"AC\\");
        assert_eq!(escape_lucene_phrase(r#"a\"b"#), r#"a\\\"b"#);
    }

    #[test]
    fn leaves_other_lucene_metacharacters_alone() {
        // Inside a quoted phrase these are literal. Escaping them would corrupt real artist names.
        for name in ["AC/DC", "Sunn O)))", "!!!", "+/-", "Godspeed You! Black Emperor"] {
            assert_eq!(escape_lucene_phrase(name), name, "over-escaped: {name}");
        }
    }
}
