use crate::error_log;
use reqwest::Client;
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime};
use tokio::time::sleep;

use super::names::{mb_artist_exact, names_are_similar};
use super::types::*;

static MB_BASE: LazyLock<String> = LazyLock::new(|| {
    env_url("MB_BASE_URL").unwrap_or_else(|| "https://musicbrainz.org/ws/2".to_string())
});
static COVER_ART_BASE: LazyLock<String> = LazyLock::new(|| {
    env_url("COVER_ART_ARCHIVE_URL").unwrap_or_else(|| "https://coverartarchive.org".to_string())
});
static USER_AGENT: LazyLock<String> = LazyLock::new(|| {
    std::env::var("MB_USER_AGENT")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            format!("DMP/{} ( https://github.com/dmp )", env!("CARGO_PKG_VERSION"))
        })
});

fn env_url(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
}

/// MusicBrainz web service root (`MB_BASE_URL`, default the public server).
pub fn mb_base() -> &'static str {
    &MB_BASE
}

/// Cover Art Archive root (`COVER_ART_ARCHIVE_URL`, default the public server).
pub fn cover_art_base() -> &'static str {
    &COVER_ART_BASE
}

/// User-Agent for every MusicBrainz-family request (`MB_USER_AGENT`). MusicBrainz asks each
/// deployment to identify itself with an application name, version and contact.
pub fn user_agent() -> &'static str {
    &USER_AGENT
}

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

/// MusicBrainz allows roughly one request per second per client; 1100ms is that with a little headroom.
///
/// The default was briefly raised to 1300ms on the theory that the 503 storm during a resolve run was
/// us exceeding the allowance. Measured against the live API, it is not: the 503 body reads
/// `{"error": "The MusicBrainz web server is currently busy. Please try again later."}` and arrives
/// with `retry-after: 0`. Slowing down bought nothing and cost ~15% throughput, so the floor is back
/// where it was.
///
/// Note the `X-RateLimit-*` headers describe a **shared global pool**, not this client's allowance -
/// currently `limit: 1200` over a one-second window (it read 15 when the note above was written).
/// `effective_delay` explains why nothing derived from them may undercut this floor.
const MIN_DELAY_FLOOR_MS: u64 = 1100;
const DEFAULT_MIN_DELAY_MS: u64 = 1100;
const MAX_DELAY_MS: u64 = 10000;

/// A load-shed 503 returns no data and explicitly says `retry-after: 0`, so the retry should not have
/// to re-pay the full inter-request delay - MusicBrainz did no work for us. A short floor keeps that
/// from becoming a hot loop against a struggling server.
const OVERLOAD_RETRY_FLOOR_MS: u64 = 250;

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

/// How many MusicBrainz requests may be in flight at once.
///
/// This is **not** a rate knob. The pacing schedule below hands out one slot per `effective_delay`
/// no matter how many callers are waiting, so N in-flight requests still consume N slots spaced
/// 1.1s apart - concurrency raises *utilisation*, never *rate*.
///
/// It exists because MusicBrainz is latency-bound, not rate-bound, for this workload. Measured live:
/// a cold `inc=recordings` browse averages ~10s (max 29.8s) and an `artist?inc=url-rels+genres+tags`
/// lookup ~10s, while the same query warm returns in 0.2s. A strictly serial client therefore
/// achieves ~1/latency = 0.15 req/s against an 0.91 req/s allowance - it spends about a sixth of its
/// own budget and leaves the wire idle the rest of the time. Overlapping requests reclaims that.
///
/// ~9 in flight saturates the schedule at 10s latency; beyond that the slot spacing is the binding
/// constraint and extra permits buy nothing.
const DEFAULT_MAX_INFLIGHT: usize = 8;

fn configured_max_inflight() -> usize {
    std::env::var("MB_MAX_INFLIGHT")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .map(|v| v.clamp(1, 16))
        .unwrap_or(DEFAULT_MAX_INFLIGHT)
}

/// Pacing state shared by every clone of a `RateLimiter`.
struct PacingState {
    delay_ms: u64,
    /// The earliest instant the next request may be issued. Claiming a slot advances it, so
    /// concurrent callers queue into distinct slots rather than compressing the schedule.
    next_slot: Instant,
    /// When the most recently claimed slot was scheduled - the basis for refunding a load-shed 503.
    last_slot: Instant,
    remaining: Option<u64>,
    reset_at: Option<u64>,
    /// Set by an overload 503 so the next `wait()` may reuse the slot that request already paid for -
    /// see `OVERLOAD_RETRY_FLOOR_MS`.
    immediate_retry: bool,
}

struct LimiterInner {
    min_delay: u64,
    max_delay: u64,
    state: tokio::sync::Mutex<PacingState>,
    inflight: tokio::sync::Semaphore,
    /// Retryable failures absorbed this run - load-shed 503s, plus transport-level blips that now
    /// share their retry ladder. Counted rather than logged per occurrence: on a long resolve pass
    /// roughly a third of requests get load-shed and recover on the first retry, and warning about
    /// each one made a healthy run read as a failing one.
    absorbed: std::sync::atomic::AtomicU64,
    /// Every request actually put on the wire, retries included. Callers sample it either side of a
    /// unit of work to report what that work cost in MusicBrainz calls - the number this whole
    /// exercise is about, and the one to watch for a regression.
    requests: std::sync::atomic::AtomicU64,
}

/// A handle onto one shared pacing schedule. Cloning is cheap and yields another handle onto the
/// *same* schedule - which is the point: MusicBrainz's budget is per-application, so every worker in a
/// concurrent run must draw from one limiter, never one each.
#[derive(Clone)]
pub struct RateLimiter {
    inner: std::sync::Arc<LimiterInner>,
}

impl RateLimiter {
    pub fn new() -> Self {
        let min_delay = configured_min_delay();
        let now = Instant::now();
        Self {
            inner: std::sync::Arc::new(LimiterInner {
                min_delay,
                max_delay: MAX_DELAY_MS,
                state: tokio::sync::Mutex::new(PacingState {
                    delay_ms: min_delay,
                    next_slot: now,
                    last_slot: now,
                    remaining: None,
                    reset_at: None,
                    immediate_retry: false,
                }),
                inflight: tokio::sync::Semaphore::new(configured_max_inflight()),
                absorbed: std::sync::atomic::AtomicU64::new(0),
                requests: std::sync::atomic::AtomicU64::new(0),
            }),
        }
    }

    pub fn set_web(&self, _web: bool) {}

    /// Requests issued so far, retries included.
    pub fn requests_issued(&self) -> u64 {
        self.inner.requests.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Retryable 503s absorbed so far.
    pub fn absorbed_503s(&self) -> u64 {
        self.inner.absorbed.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn note_absorbed_503(&self) {
        self.inner
            .absorbed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// A load-shed 503 served nothing, so the retry should not have to buy a fresh pacing slot. This
    /// is where most of a resolve run's lost time went: the retry itself is cheap, but re-paying the
    /// ~1.1s inter-request delay for a request MusicBrainz never answered is not.
    pub async fn allow_immediate_retry(&self) {
        self.inner.state.lock().await.immediate_retry = true;
    }

    /// Claim the next issue slot, then sleep until it comes round.
    ///
    /// **This is the single choke point for the request rate.** Every caller - however many run
    /// concurrently - takes a slot from one monotonic schedule and pushes `next_slot` forward by a
    /// full `effective_delay`, so the aggregate issue rate is exactly one request per delay. Adding
    /// workers changes when the budget is spent, never how much of it.
    pub async fn wait(&self) {
        let slot = {
            let mut st = self.inner.state.lock().await;
            let now = Instant::now();
            let step = Duration::from_millis(self.effective_delay(&st));

            // A load-shed 503 refunds the slot it already paid for, rather than buying a new one -
            // but only while nothing else is queued. Under concurrency the wire is busy by
            // definition, and letting retries jump the queue there is exactly how a "retry cheaply"
            // rule turns into exceeding the rate. So when callers are waiting, a retry queues like
            // any other request.
            let idle = st.next_slot <= now + step;
            let slot = if std::mem::take(&mut st.immediate_retry) && idle {
                (st.last_slot + Duration::from_millis(OVERLOAD_RETRY_FLOOR_MS)).max(now)
            } else if st.next_slot > now {
                st.next_slot
            } else {
                now
            };

            st.last_slot = slot;
            st.next_slot = slot + step;
            slot
        };
        self.inner
            .requests
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        tokio::time::sleep_until(slot.into()).await;
    }

    /// The pacing slot to honour before the next request. **Never returns less than `min_delay`** -
    /// that floor is MusicBrainz's published rate and nothing derived from a response header may
    /// undercut it.
    ///
    /// `X-RateLimit-Remaining` is not our budget. It is a **shared, global** counter: measured live it
    /// reports `x-ratelimit-limit: 1200` over a one-second window and drifts 886 -> 619 -> 511 -> 472
    /// while this client spends three requests. So `remaining` dropping is other clients' traffic, and
    /// the old low-budget branch returned `max_delay.min(secs_left * 1000 / 2)` = `min(10000, 500)` =
    /// 500ms - i.e. whenever MusicBrainz was busiest globally we sped up to twice its published rate.
    /// Now a nearly-drained pool backs us off toward `max_delay` instead, which is what the branch was
    /// always meant to do.
    fn effective_delay(&self, st: &PacingState) -> u64 {
        let min_delay = self.inner.min_delay;
        if let (Some(remaining), Some(reset_at)) = (st.remaining, st.reset_at) {
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let secs_left = reset_at.saturating_sub(now).max(1);
            if remaining <= 10 {
                return self.inner.max_delay.max(min_delay);
            }
            let ideal = (secs_left * 1000) / (remaining * 80 / 100).max(1);
            return ideal.max(min_delay).min(st.delay_ms.max(min_delay));
        }
        st.delay_ms.max(min_delay)
    }

    async fn update_from_headers(&self, remaining: Option<u64>, reset_at: Option<u64>) {
        let mut st = self.inner.state.lock().await;
        st.remaining = remaining;
        st.reset_at = reset_at;
    }

    async fn on_success(&self) {
        let mut st = self.inner.state.lock().await;
        let min_delay = self.inner.min_delay;
        if st.delay_ms > min_delay {
            st.delay_ms = st.delay_ms.saturating_sub(RECOVERY_STEP_MS).max(min_delay);
        }
    }

    async fn on_rate_limit(&self) {
        let mut st = self.inner.state.lock().await;
        st.delay_ms = (st.delay_ms * 2).min(self.inner.max_delay);
        st.remaining = None;
        st.reset_at = None;
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
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
        || e.contains("502")
        || e.contains("504")
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

        // Held only for the round trip. The pacing schedule above already fixed *when* this request
        // may go out; this bounds how many may be outstanding at once so a stall on MusicBrainz's
        // side cannot pile up unboundedly.
        let permit = limiter
            .inner
            .inflight
            .acquire()
            .await
            .map_err(|e| format!("Request failed: limiter closed: {}", e))?;

        let sent = client
            .get(url)
            .header("User-Agent", user_agent())
            .header("Accept", "application/json")
            .send()
            .await;

        // A transport-level failure - read timeout, connection reset, DNS blip - used to bail out of
        // `mb_get` immediately via `?`, with none of the retry ladder the HTTP-level 503s get. Callers
        // then classified it Transient and abandoned the whole artist on a single blip.
        //
        // Rare enough to ignore while requests went out one at a time and the wire sat idle between
        // them. Not rare once requests overlap: a cold `inc=recordings` browse can take 29.8s against
        // a 30s client timeout, so several in flight will occasionally cross it. Retried here on the
        // same ladder as an overload, which is what it is - MusicBrainz served us nothing.
        let resp = match sent {
            Ok(r) => r,
            Err(e) => {
                if attempt < max_attempts - 1 {
                    drop(permit);
                    ladder = (ladder * 2).min(16000);
                    limiter.note_absorbed_503();
                    limiter.allow_immediate_retry().await;
                    continue;
                }
                return Err(format!("Request failed: {}", e));
            }
        };

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
        limiter.update_from_headers(rl_remaining, rl_reset).await;

        if status == 200 {
            limiter.on_success().await;
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Read body failed: {}", e));
            drop(permit);
            return body;
        }

        if matches!(status, 502 | 503 | 504 | 429) {
            // 502/504 are the reverse proxy in front of MB, not MB itself - never carry a rate-limit
            // body or X-RateLimit-* headers, so classify_throttle always reads them as Overloaded
            // (immediate retry, no pacing penalty). A sustained run previously hard-failed the whole
            // artist on the first 502/504 with zero retry - during a long backfill these are common
            // enough (bursts of them, not isolated blips) to abort a large fraction of artists outright.
            //
            // The body is what separates MB's rate-limit 503 from a plain overload 503. It is small,
            // and this branch is already the slow path, so reading it costs nothing that matters.
            let body = resp.text().await.unwrap_or_default();
            drop(permit);
            let kind = classify_throttle(status, rl_remaining, &body);
            if kind == ThrottleKind::RateLimited && !penalised {
                limiter.on_rate_limit().await;
                penalised = true;
            }
            if attempt < max_attempts - 1 {
                ladder = (ladder * 2).min(16000);
                limiter.note_absorbed_503();

                match kind {
                    // Load shedding, not us: MusicBrainz served nothing and says `retry-after: 0`. Do
                    // not re-pay the inter-request delay for a request it never answered, and do not
                    // report it - it recovers on the first retry and warning about each one turned a
                    // healthy run into a wall of red. The run summary carries the total instead.
                    ThrottleKind::Overloaded => {
                        limiter.allow_immediate_retry().await;
                        if let Some(ms) = retry_after {
                            if ms > OVERLOAD_RETRY_FLOOR_MS {
                                sleep(Duration::from_millis(ms)).await;
                            }
                        }
                    }
                    // Genuinely over the allowance: back off loudly, this one is actionable.
                    ThrottleKind::RateLimited => {
                        let wait_time = retry_after.unwrap_or(ladder);
                        error_log::log_warn(&format!(
                            "HTTP {} (rate-limit) (attempt {}/{})",
                            status,
                            attempt + 1,
                            max_attempts - 1
                        ));
                        eprintln!(
                            "      ⚠ HTTP {} (rate-limit) - waiting {:.1}s before next attempt ({}/{}) [delay_ms={}]",
                            status,
                            wait_time as f64 / 1000.0,
                            attempt + 1,
                            max_attempts - 1,
                            limiter.inner.state.lock().await.delay_ms,
                        );
                        sleep(Duration::from_millis(wait_time)).await;
                    }
                }
                continue;
            } else {
                return Err(format!(
                    "MusicBrainz API still unavailable after {} retries (waited up to {}s). Will retry this release next time.",
                    max_attempts,
                    ladder / 1000
                ));
            }
        }

        drop(permit);
        return Err(format!("HTTP {} for {}", status, url));
    }

    Err("Max retries exceeded".to_string())
}

/// Advance a browse cursor, and say whether another page is owed.
///
/// MusicBrainz caps a browse response by **size, not `limit`**, once `inc=recordings` is on: a
/// `limit=100` page routinely comes back with 30-50 rows and more still to fetch. `OK Computer`
/// reports `release-count: 39` and serves 31, so the obvious `returned < limit => last page` rule
/// silently dropped its remaining 8 - every `OKNOTOK 1997 2017` deluxe edition, i.e. precisely the
/// editions sync's deluxe-upgrade path exists to find.
///
/// So: step by what actually arrived, and stop only on the server's own total (or on an empty page,
/// which also guards against a missing/garbage count looping forever).
fn advance_browse(offset: &mut u32, returned: usize, total: Option<u32>) -> bool {
    let returned = returned as u32;
    *offset += returned;
    returned > 0 && *offset < total.unwrap_or(0)
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
        mb_base(), quoted
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
        mb_base(), quoted
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
    // `inc=aliases`, and actually parsing them: this feeds the ladder's step 1 (an embedded/stored id
    // looked up directly), and the certainty gate needs an artist's alias set to confirm a row whose
    // tag spells the name differently from MB's own ("N.W.W." for "Nurse With Wound"). Without aliases
    // here, `mb_artist_exact` silently degrades to bare-name equality and rejects a real, legitimate
    // alias spelling.
    let url = format!("{}/artist/{}?inc=aliases&fmt=json", mb_base(), mb_artist_id);
    let body = mb_get(client, &url, limiter).await?;

    #[derive(serde::Deserialize)]
    struct ArtistLookup {
        id: String,
        name: String,
        #[serde(default)]
        aliases: Option<Vec<MbAlias>>,
    }
    let a: ArtistLookup = serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
    Ok(MbArtistMatch {
        id: a.id,
        name: a.name,
        score: Some(100),
        aliases: a.aliases,
    })
}

pub async fn mb_lookup_release_group_artist(
    client: &Client,
    mb_release_group_id: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<MbArtistMatch>, String> {
    let url = format!(
        "{}/release-group/{}?inc=artist-credits&fmt=json",
        mb_base(), mb_release_group_id
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
        mb_base(), encoded
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
/// Top hit only. Callers that must skip a disallowed candidate (a Single-typed group MusicBrainz
/// scores first, say) should use [`mb_search_release_groups`] and pick from the whole shortlist.
pub async fn mb_search_release_group(
    client: &Client,
    album_title: &str,
    artist_name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<SearchedReleaseGroup>, String> {
    Ok(
        mb_search_release_groups(client, album_title, artist_name, limiter)
            .await?
            .into_iter()
            .next(),
    )
}

/// The search shortlist, best score first.
pub async fn mb_search_release_groups(
    client: &Client,
    album_title: &str,
    artist_name: &str,
    limiter: &mut RateLimiter,
) -> Result<Vec<SearchedReleaseGroup>, String> {
    let query = format!(
        "releasegroup:\"{}\" AND artist:\"{}\"",
        escape_lucene_phrase(album_title),
        escape_lucene_phrase(artist_name),
    );
    let encoded = urlencoding::encode(&query);
    let url = format!(
        "{}/release-group/?query={}&limit=5&fmt=json",
        mb_base(), encoded
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
        })
        .collect())
}

pub async fn mb_get_artist_detail(
    client: &Client,
    mb_id: &str,
    limiter: &mut RateLimiter,
) -> Result<MbArtistDetail, String> {
    let url = format!(
        "{}/artist/{}?inc=url-rels+genres+tags&fmt=json",
        mb_base(), mb_id
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
            mb_base(), mb_id, limit, offset
        );
        let body = mb_get(client, &url, limiter).await?;
        let result: MbReleaseGroupList =
            serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

        let count = result.release_groups.len();
        let total = result.release_group_count;
        all_groups.extend(result.release_groups);
        if !advance_browse(&mut offset, count, total) {
            break;
        }
    }

    Ok(all_groups)
}

/// Release-group ids of this artist that have at least one **Official** release.
///
/// A release group carries no status - status lives on the releases inside it - so the album-oriented
/// allow-list alone cannot tell "OK Computer" from a bootleg soundboard recording: both are primary
/// type Album, and the bootleg's Live secondary type is one we deliberately keep (official live albums
/// belong in the catalogue). Browsing the artist's official releases once and keeping only the groups
/// that appear is what separates them. Filtering server-side by `status=official&type=album|ep` keeps
/// this to ~4 pages even for an artist with 500 releases; asking per release group would be one call
/// per gap (366 for Radiohead).
pub async fn mb_get_official_release_group_ids(
    client: &Client,
    mb_id: &str,
    limiter: &mut RateLimiter,
) -> Result<std::collections::HashSet<String>, String> {
    Ok(mb_get_official_artist_catalogue(client, mb_id, limiter)
        .await?
        .official_rg_ids)
}

/// Everything one artist-scoped browse can tell us: which release groups have an Official release,
/// **and** the tracklist of every one of those releases.
///
/// The `official_rg_ids` half is what `mb_get_official_release_group_ids` always returned - same URL,
/// same filter, same set. The second half is free: adding `+recordings` to a browse we already make
/// once per artist returns full `media[].tracks[]` (id, title, position, length, recording).
///
/// That matters because `owned::detect_containment` used to spend **one paginated browse per
/// uncovered release group, per artist, on every run**, and never cached a negative result. Measured
/// over the live library that is 14.8 such calls for an average artist, 184 at p99 and 813 at worst -
/// each one a cold `inc=recordings` query averaging ~10s. Serving them all from here costs a handful
/// of extra pages: Radiohead's browse grows from ~4 pages to 11 and returns 322 releases across 39
/// groups, every one carrying tracklists (its 39 `OK Computer` editions match that group's own
/// `release-count` exactly).
///
/// Editions are filtered exactly as `mb_get_release_tracks` filters them - a release whose media are
/// all video carriers is dropped - so a value here is indistinguishable from a per-group fetch.
pub struct OfficialArtistCatalogue {
    /// Release groups with at least one Official release.
    pub official_rg_ids: std::collections::HashSet<String>,
    /// Release group id -> its Official editions, each with its flattened audio tracklist.
    pub editions_by_rg: std::collections::HashMap<String, Vec<(MbRelease, Vec<MbTrack>)>>,
}

pub async fn mb_get_official_artist_catalogue(
    client: &Client,
    mb_id: &str,
    limiter: &mut RateLimiter,
) -> Result<OfficialArtistCatalogue, String> {
    #[derive(serde::Deserialize)]
    struct ReleaseGroupRef {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct BrowsedRelease {
        #[serde(flatten)]
        release: MbRelease,
        #[serde(rename = "release-group")]
        release_group: Option<ReleaseGroupRef>,
    }
    #[derive(serde::Deserialize)]
    struct BrowsedReleaseList {
        releases: Vec<BrowsedRelease>,
        #[serde(rename = "release-count")]
        release_count: Option<u32>,
    }

    let mut official_rg_ids = std::collections::HashSet::new();
    let mut editions_by_rg: std::collections::HashMap<String, Vec<(MbRelease, Vec<MbTrack>)>> =
        std::collections::HashMap::new();
    let mut offset = 0u32;
    let limit = 100u32;

    loop {
        let url = format!(
            "{}/release?artist={}&status=official&type=album|ep&inc=release-groups+recordings&limit={}&offset={}&fmt=json",
            mb_base(), mb_id, limit, offset
        );
        let body = mb_get(client, &url, limiter).await?;
        let result: BrowsedReleaseList =
            serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

        let count = result.releases.len();
        let total = result.release_count;
        for browsed in result.releases {
            let Some(rg) = browsed.release_group else {
                continue;
            };
            official_rg_ids.insert(rg.id.clone());
            let tracks = flatten_audio_tracks(&browsed.release.media);
            // Same guard as mb_get_release_tracks: a video-only release has nothing to offer a
            // track-count comparison and must not win an exact-count tiebreak against an empty folder.
            if browsed.release.media.is_some() && tracks.is_empty() {
                continue;
            }
            editions_by_rg
                .entry(rg.id)
                .or_default()
                .push((browsed.release, tracks));
        }

        if !advance_browse(&mut offset, count, total) {
            break;
        }
    }

    Ok(OfficialArtistCatalogue {
        official_rg_ids,
        editions_by_rg,
    })
}

/// The release's media, in order, with non-audio media (a Blu-ray/DVD bonus disc) dropped via
/// `allowlist::is_audio_medium` - see that fn's doc comment for why medium format (not the
/// per-recording `video` flag) is the signal. Shared by `flatten_audio_tracks` (per-track) and
/// anything that needs one row per disc (`MusicBrainzReleaseMedium`), so both stay in agreement
/// about which media exist on a release.
pub fn audio_media(media: &Option<Vec<MbMedia>>) -> Vec<&MbMedia> {
    media
        .as_ref()
        .map(|media| {
            media
                .iter()
                .filter(|m| super::allowlist::is_audio_medium(m.format.as_deref()))
                .collect()
        })
        .unwrap_or_default()
}

/// Flattens a release's media into one track list, in medium order, skipping non-audio media (a
/// Blu-ray/DVD bonus disc) via `audio_media`. `discNumber` is still stamped from the medium's own
/// `position`, so an audio medium after a dropped video medium keeps MusicBrainz's original
/// numbering rather than being renumbered.
pub fn flatten_audio_tracks(media: &Option<Vec<MbMedia>>) -> Vec<MbTrack> {
    let mut tracks = Vec::new();
    for medium in audio_media(media) {
        if let Some(ref trks) = medium.tracks {
            for trk in trks {
                let mut t = trk.clone();
                t.disc_number = medium.position;
                tracks.push(t);
            }
        }
    }
    tracks
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
            mb_base(), release_group_id, limit, offset
        );
        let body = mb_get(client, &url, limiter).await?;
        let result: MbReleaseList =
            serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;
        let count = result.releases.len();
        let total = result.release_count;
        all_releases.extend(result.releases);
        if !advance_browse(&mut offset, count, total) {
            break;
        }
    }

    let mut releases = Vec::new();
    for release in all_releases {
        if let Some(ref status) = release.status {
            if !status.eq_ignore_ascii_case("Official") {
                continue;
            }
        }
        let tracks = flatten_audio_tracks(&release.media);
        // A release whose only media are video carriers (a video-only "release") has nothing to
        // offer the matcher and must not win an exact-track-count tiebreak against an empty folder.
        if release.media.is_some() && tracks.is_empty() {
            continue;
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
        mb_base(), release_id
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

    let tracks = flatten_audio_tracks(&lookup.release.media);

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
        let now = Instant::now();
        RateLimiter {
            inner: std::sync::Arc::new(LimiterInner {
                min_delay: DEFAULT_MIN_DELAY_MS,
                max_delay: MAX_DELAY_MS,
                state: tokio::sync::Mutex::new(PacingState {
                    delay_ms,
                    next_slot: now,
                    last_slot: now,
                    remaining: None,
                    reset_at: None,
                    immediate_retry: false,
                }),
                inflight: tokio::sync::Semaphore::new(DEFAULT_MAX_INFLIGHT),
                absorbed: std::sync::atomic::AtomicU64::new(0),
                requests: std::sync::atomic::AtomicU64::new(0),
            }),
        }
    }

    /// `delay_ms` now lives behind the shared state's mutex; these helpers keep the behavioural
    /// assertions below reading exactly as they did when it was a plain field.
    fn delay_of(l: &RateLimiter) -> u64 {
        futures::executor::block_on(l.inner.state.lock()).delay_ms
    }
    fn min_delay_of(l: &RateLimiter) -> u64 {
        l.inner.min_delay
    }

    #[tokio::test]
    async fn recovery_is_additive_and_floors_at_min_delay() {
        let l = limiter_at(5000);
        l.on_success().await;
        assert_eq!(delay_of(&l), 4900, "one success sheds exactly RECOVERY_STEP_MS");
        let floor = min_delay_of(&l);
        let l = limiter_at(floor + 50);
        l.on_success().await;
        assert_eq!(delay_of(&l), floor, "recovery never undercuts the floor");
        l.on_success().await;
        assert_eq!(delay_of(&l), floor, "already at the floor is a no-op");
    }

    #[tokio::test]
    async fn rate_limit_doubles_and_caps() {
        let l = limiter_at(4000);
        l.on_rate_limit().await;
        assert_eq!(delay_of(&l), 8000);
        l.on_rate_limit().await;
        assert_eq!(delay_of(&l), MAX_DELAY_MS, "capped, not 16000");
    }

    #[tokio::test]
    async fn a_single_call_penalises_the_pace_at_most_once() {
        // Mirrors mb_get's `penalised` latch: five retries of one unlucky name must cost one doubling,
        // not five. Before this, one bad name pinned every later name at the 10s cap.
        let l = limiter_at(1300);
        let mut penalised = false;
        for _ in 0..5 {
            let kind = classify_throttle(503, None, RATE_LIMIT_BODY);
            if kind == ThrottleKind::RateLimited && !penalised {
                l.on_rate_limit().await;
                penalised = true;
            }
        }
        assert_eq!(delay_of(&l), 2600);
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
    fn the_real_busy_body_musicbrainz_serves_is_classified_as_overload() {
        // Captured from the live API during a resolve run. It arrives with `x-ratelimit-remaining: 14`
        // of `x-ratelimit-limit: 15` and `retry-after: 0` - i.e. we are using a fifteenth of the
        // allowance and MusicBrainz is simply load-shedding. Reading this as a rate limit is what made
        // an earlier fix slow the client down for no benefit.
        const BUSY: &str =
            r#"{"error": "The MusicBrainz web server is currently busy. Please try again later."}"#;
        assert_eq!(
            classify_throttle(503, Some(14), BUSY),
            ThrottleKind::Overloaded
        );
    }

    #[tokio::test]
    async fn an_overload_retry_skips_the_pacing_slot() {
        // The throughput fix: a load-shed 503 served no data, so the retry must not queue behind a full
        // inter-request delay. Roughly a third of requests on a long run take this path.
        let l = limiter_at(DEFAULT_MIN_DELAY_MS);
        l.wait().await; // establishes the first slot
        l.allow_immediate_retry().await;
        let started = Instant::now();
        l.wait().await;
        let waited = started.elapsed().as_millis() as u64;
        assert!(
            waited < DEFAULT_MIN_DELAY_MS,
            "immediate retry waited {waited}ms - it must not re-pay the {DEFAULT_MIN_DELAY_MS}ms slot"
        );

        // ...and the flag is one-shot: the next request pays full price again.
        l.allow_immediate_retry().await;
        l.wait().await;
        let started = Instant::now();
        l.wait().await;
        assert!(
            started.elapsed().as_millis() as u64 > OVERLOAD_RETRY_FLOOR_MS,
            "the immediate-retry flag leaked into a normal request"
        );
    }

    /// **The guard on the whole concurrency design.** Whatever the worker count, the shared schedule
    /// must issue no faster than one request per `min_delay` - concurrency is allowed to raise how
    /// much of MusicBrainz's allowance we use, never the allowance itself.
    #[tokio::test]
    async fn concurrent_workers_never_issue_faster_than_the_floor() {
        const WORKERS: usize = 8;
        const PER_WORKER: usize = 3;
        const TOTAL: usize = WORKERS * PER_WORKER;

        let l = limiter_at(DEFAULT_MIN_DELAY_MS);
        let started = Instant::now();
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..WORKERS {
            let l = l.clone();
            set.spawn(async move {
                for _ in 0..PER_WORKER {
                    l.wait().await;
                }
            });
        }
        while set.join_next().await.is_some() {}

        let elapsed = started.elapsed().as_millis() as u64;
        let floor = (TOTAL as u64 - 1) * DEFAULT_MIN_DELAY_MS;
        assert!(
            elapsed >= floor,
            "{TOTAL} requests across {WORKERS} workers took {elapsed}ms - the schedule must spread \
             them over at least {floor}ms or we are exceeding MusicBrainz's rate"
        );
    }

    /// A clone shares the schedule rather than starting a fresh one - the whole point of the handle.
    /// If clones paced independently, N workers would issue at N times the allowed rate.
    #[tokio::test]
    async fn a_clone_shares_the_schedule_it_was_cloned_from() {
        let a = limiter_at(DEFAULT_MIN_DELAY_MS);
        let b = a.clone();
        a.wait().await;
        let started = Instant::now();
        b.wait().await;
        assert!(
            started.elapsed().as_millis() as u64 >= DEFAULT_MIN_DELAY_MS - 50,
            "a clone paced independently of its source"
        );
    }

    /// The header-derived branches must never undercut the floor. `remaining` is a *global* pool, so a
    /// busy minute on MusicBrainz's side used to hand back 500ms - twice the published rate, exactly
    /// when the server could least afford it.
    #[tokio::test]
    async fn header_derived_pacing_never_undercuts_the_floor() {
        let l = limiter_at(DEFAULT_MIN_DELAY_MS);
        let reset_at = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + 1;

        // A nearly-drained shared pool: back off, never speed up.
        l.update_from_headers(Some(3), Some(reset_at)).await;
        let st = l.inner.state.lock().await;
        assert!(l.effective_delay(&st) >= DEFAULT_MIN_DELAY_MS);
        drop(st);

        // A healthy pool with a 1s window: the naive ideal is ~1ms, and must still clamp to the floor.
        l.update_from_headers(Some(1000), Some(reset_at)).await;
        let st = l.inner.state.lock().await;
        assert!(l.effective_delay(&st) >= DEFAULT_MIN_DELAY_MS);
    }

    /// The bug this exists to prevent: `OK Computer` says 39 releases and serves 31, so a browse must
    /// ask for the rest instead of reading the short page as the end. Dropping those 8 dropped every
    /// `OKNOTOK 1997 2017` edition from the matcher's view.
    #[test]
    fn a_short_page_is_not_the_last_page() {
        let mut offset = 0;
        assert!(
            advance_browse(&mut offset, 31, Some(39)),
            "31 of 39 is a short page, not the end"
        );
        assert_eq!(offset, 31, "the cursor steps by what arrived, not by `limit`");
        assert!(!advance_browse(&mut offset, 8, Some(39)), "39 of 39 is the end");
        assert_eq!(offset, 39);
    }

    #[test]
    fn a_browse_terminates_on_an_empty_page_or_a_missing_count() {
        // Both guard against looping forever: MusicBrainz occasionally answers with neither.
        let mut offset = 50;
        assert!(!advance_browse(&mut offset, 0, Some(999)), "an empty page ends it");
        let mut offset = 0;
        assert!(!advance_browse(&mut offset, 10, None), "no count means stop, not spin");
    }

    #[test]
    fn a_single_full_page_ends_the_browse() {
        let mut offset = 0;
        assert!(!advance_browse(&mut offset, 12, Some(12)));
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
    fn classifies_bad_gateway_and_gateway_timeout_as_transient() {
        // The reverse proxy in front of MB, not MB's own app - previously fell through to Hard with
        // zero retry, aborting the whole artist on the first blip during a long-running backfill.
        assert_eq!(
            classify_mb_error("HTTP 502 for https://musicbrainz.org/..."),
            MbErrorKind::Transient,
        );
        assert_eq!(
            classify_mb_error("HTTP 504 for https://musicbrainz.org/..."),
            MbErrorKind::Transient,
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

    fn mb_track(id: &str, title: &str) -> MbTrack {
        MbTrack {
            id: id.to_string(),
            title: title.to_string(),
            position: Some(1),
            length: None,
            disc_number: None,
            recording: None,
        }
    }

    fn medium(position: u32, format: Option<&str>, tracks: Vec<MbTrack>) -> MbMedia {
        MbMedia {
            position: Some(position),
            format: format.map(|f| f.to_string()),
            title: None,
            track_count: None,
            tracks: Some(tracks),
        }
    }

    #[test]
    fn bonus_bluray_medium_is_excluded_from_the_track_list() {
        // The MOON incident: CD medium (4 audio tracks) + Blu-ray medium (1 video track) must
        // flatten to 4, not 5, or a perfect audio rip fails the completeness gate forever.
        let media = Some(vec![
            medium(
                1,
                Some("CD"),
                vec![
                    mb_track("t1", "magnet"),
                    mb_track("t2", "GATE"),
                    mb_track("t3", "Kick it"),
                    mb_track("t4", "mott\u{f6} (JUDY AND MARY cover)"),
                ],
            ),
            medium(
                2,
                Some("Blu-ray"),
                vec![mb_track("t5", "YON FES 2024 Live")],
            ),
        ]);
        let tracks = flatten_audio_tracks(&media);
        assert_eq!(tracks.len(), 4);
        assert!(tracks.iter().all(|t| t.disc_number == Some(1)));
    }

    #[test]
    fn a_medium_with_no_format_is_kept() {
        let media = Some(vec![medium(1, None, vec![mb_track("t1", "Untitled")])]);
        assert_eq!(flatten_audio_tracks(&media).len(), 1);
    }

    #[test]
    fn a_release_whose_only_medium_is_video_flattens_to_nothing() {
        let media = Some(vec![medium(
            1,
            Some("DVD-Video"),
            vec![mb_track("t1", "Bonus")],
        )]);
        assert!(flatten_audio_tracks(&media).is_empty());
    }
}
