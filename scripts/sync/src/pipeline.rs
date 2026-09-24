//! Per-artist sync processing, extracted from `main.rs`'s concurrent `stream::iter(...).map(...)`
//! pipeline - the single largest, most-executed piece of this binary. `ArtistWorkerCtx` bundles the
//! per-worker clones/borrows `main()`'s `.map()` closure builds each iteration; `process_artist` is
//! that closure's async body verbatim, just given a name and a context struct instead of ~15 loose
//! captures.

use crate::{SyncArgs, SEARCH_MIN_SCORE};
use common::config::Config;
use common::consensus;
use common::images::download_artist_image;
use common::progress::Reporter;
use common::statistics::update_statistics;
use common::types::TrackMeta;
use dmp_sync::db::*;
use dmp_sync::images::download_cover_art;
use dmp_sync::mb_api;
use dmp_sync::mb_api::RateLimiter;
use dmp_sync::mb_matching;
use dmp_sync::mb_matching::{find_mb_match_with_fallback, is_special_artist_name};
use dmp_sync::mb_types;
use dmp_sync::mb_types::{MbArtistMatch, MbRelease, MbTrack};
use dmp_sync::owned;
use dmp_sync::status;
use dmp_sync::status::{check_release_status, format_from_media, status_to_db_string};
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// `process_artist`'s image-download background tasks: `(artist name, result)` per finished download.
pub(crate) type ImageTaskResult = (String, Result<bool, String>);
pub(crate) type ImageTasks = Arc<tokio::sync::Mutex<tokio::task::JoinSet<ImageTaskResult>>>;

/// Prefixes every message with `[artist name] ` before forwarding to the real `Reporter`. Concurrency
/// interleaves several artists' output on one stream (6 workers by default), so a bare message reads
/// as if a single release were stuck repeating - every line needs to say whose it is.
struct ArtistReporter<'a> {
    inner: &'a Reporter,
    name: &'a str,
}

impl<'a> ArtistReporter<'a> {
    fn new(inner: &'a Reporter, name: &'a str) -> Self {
        Self { inner, name }
    }

    fn tag(&self, msg: &str) -> String {
        format!("[{}] {}", self.name, msg)
    }

    fn info(&self, msg: &str) {
        self.inner.info(&self.tag(msg));
    }

    fn step(&self, msg: &str) {
        self.inner.step(&self.tag(msg));
    }

    fn ok(&self, msg: &str) {
        self.inner.ok(&self.tag(msg));
    }

    fn sub_ok(&self, msg: &str) {
        self.inner.sub_ok(&self.tag(msg));
    }

    fn skip(&self, msg: &str) {
        self.inner.skip(&self.tag(msg));
    }

    fn warn(&self, msg: &str) {
        self.inner.warn(&self.tag(msg));
    }

    fn err(&self, msg: &str) {
        self.inner.err(&self.tag(msg));
    }
}

/// What one artist contributed to the run totals. Returned rather than accumulated in place so the
/// per-artist work needs no shared counters.
#[derive(Default)]
pub(crate) struct ArtistOutcome {
    pub(crate) synced: bool,
    pub(crate) partial: bool,
    pub(crate) failed: Option<(String, String)>,
}

fn search_match_acceptable(
    score: u32,
    candidate_title: &str,
    local_title: &str,
    primary_type: Option<&str>,
    secondary_types: &[String],
) -> bool {
    score >= SEARCH_MIN_SCORE
        && mb_matching::names_are_similar(candidate_title, local_title)
        && common::mb::allowlist::is_allowed(primary_type, secondary_types, None)
}

/// One MB candidate a local release may bind to. `release_id` is set only by Tier 1 (a direct release
/// lookup); the browse/search tiers leave it empty and let `check_release_status` pick the edition.
///
/// `from_tags` records whether the files pointed here themselves (Tier 1/2 embedded ids) rather than a
/// title search. Only a tagged candidate may bind a Single-typed group - see `allowlist::is_allowed_tagged`.
struct MatchCandidate {
    release_id: String,
    rg_id: String,
    releases: Vec<(MbRelease, Vec<MbTrack>)>,
    primary_type: Option<String>,
    secondary_types: Vec<String>,
    from_tags: bool,
}

enum SearchOutcome {
    Found(MatchCandidate),
    NotFound,
    /// MB was unavailable - the caller leaves the release alone so the next run retries it.
    Transient,
}

/// Tier 3: find a release group by album title + artist. Extracted so the allow-list gate can reuse
/// it as a fallback when the tags point at a release the library refuses to bind (a bootleg edition,
/// or a group MusicBrainz types as a Single) - before, that rejection was a dead end and the release
/// stayed Unmatched even though the correct official album was one search away.
async fn search_release_candidate(
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &ArtistReporter<'_>,
    local_title: &str,
    artist_name: &str,
    verbose: bool,
) -> SearchOutcome {
    let api_start = std::time::Instant::now();
    reporter.info(&format!(
        "        → Search MusicBrainz for \"{}\" by {}",
        local_title, artist_name
    ));
    // The whole shortlist, not just the top hit: MusicBrainz frequently scores a Single-typed group
    // first for an album's own name (searching "Amnesiac" by Radiohead returns the *single* at score
    // 100 and the album at score 100 behind it). Taking only the best hit meant one disallowed
    // candidate hid the correct album and the release stayed Unmatched.
    let hits = match mb_api::mb_search_release_groups(
        http_client,
        local_title,
        artist_name,
        limiter,
    )
    .await
    {
        Ok(hits) => hits,
        Err(e) if mb_api::classify_mb_error(&e) == mb_api::MbErrorKind::Transient => {
            return SearchOutcome::Transient
        }
        Err(e) => {
            reporter.warn(&format!("{}: search failed: {}", local_title, e));
            return SearchOutcome::NotFound;
        }
    };

    let Some(found) = hits.into_iter().find(|hit| {
        search_match_acceptable(
            hit.score,
            &hit.title,
            local_title,
            hit.primary_type.as_deref(),
            &hit.secondary_types,
        )
    }) else {
        if verbose {
            reporter.skip(&format!("{} (no confident search match)", local_title));
        }
        return SearchOutcome::NotFound;
    };

    reporter.info(&format!(
        "        ← Search hit {} (score {}) in {:.1}s - browsing editions",
        found.id,
        found.score,
        api_start.elapsed().as_secs_f64()
    ));
    match mb_api::mb_get_release_tracks(http_client, &found.id, limiter).await {
        Ok(releases) if !releases.is_empty() => SearchOutcome::Found(MatchCandidate {
            release_id: String::new(),
            rg_id: found.id,
            releases,
            primary_type: found.primary_type,
            secondary_types: found.secondary_types,
            from_tags: false,
        }),
        Err(e) if mb_api::classify_mb_error(&e) == mb_api::MbErrorKind::Transient => {
            SearchOutcome::Transient
        }
        _ => {
            if verbose {
                reporter.skip(&format!(
                    "{} (search hit had no official editions)",
                    local_title
                ));
            }
            SearchOutcome::NotFound
        }
    }
}

/// A failed artist lookup is not "no match": nothing is stamped, so the artist stays pending and the
/// next run asks again.
fn artist_lookup_failed(
    r: &ArtistReporter<'_>,
    mut outcome: ArtistOutcome,
    name: &str,
    e: &str,
) -> ArtistOutcome {
    r.err(&format!("Search error: {}", e));
    outcome.failed = Some((name.to_string(), format!("Search error: {}", e)));
    outcome
}

/// An artist is only stamped "done" for this run when it isn't a total failure - otherwise a resume
/// would skip it despite it having accomplished nothing. `release_failures > 0` alone is not a
/// sufficient signal (docs/sync_decisions.md): a failed release-groups fetch leaves an artist whose
/// local releases have no embedded MB id with `processed_count == 0` AND `release_failures == 0`
/// (nothing ever called a per-release API function to fail), which would silently stamp it complete
/// without `release_groups_fetch_failed` closing that gap.
fn is_artist_total_failure(
    processed_count: u32,
    release_failures: u32,
    release_groups_fetch_failed: bool,
) -> bool {
    processed_count == 0 && (release_failures > 0 || release_groups_fetch_failed)
}

/// `LocalTrackRow` -> `consensus::TrackTags`, for the no-guessing gate (docs/no_guessing.md).
fn consensus_tags_from_rows(tracks: &[LocalTrackRow]) -> Vec<consensus::TrackTags> {
    tracks
        .iter()
        .map(|t| consensus::TrackTags {
            id: t.id.clone(),
            album: t.album.clone(),
            year: t.year,
            mb_release_id: t.mb_release_id.clone(),
            mb_release_group_id: t.mb_release_group_id.clone(),
            disc_number: t.disc_number,
            track_number: t.track_number,
            file_path: None,
        })
        .collect()
}

fn synthesize_edition_label(
    release: &mb_types::MbRelease,
    rg_first_release_date: Option<&str>,
) -> Option<String> {
    if release
        .disambiguation
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
    {
        return None;
    }
    let release_year = release.date.as_deref().and_then(year_from_date)?;
    let rg_year = rg_first_release_date.and_then(year_from_date);
    match rg_year {
        Some(rg_y) if rg_y == release_year => Some("original release".to_string()),
        Some(_) => Some(format!("{} reissue", release_year)),
        None => None,
    }
}

fn year_from_date(date: &str) -> Option<i32> {
    date.split('-').next()?.parse::<i32>().ok()
}

/// How many artist images may be in flight at once. Small on purpose: the point is to stop the fetches
/// blocking the MusicBrainz loop, not to hammer Wikidata/Wikipedia/Fanart.
pub(crate) const MAX_IMAGE_TASKS: usize = 4;

/// Fetch an artist image and record it, on a task of its own.
///
/// Image lookups go to Wikidata/Wikipedia/Fanart, never to MusicBrainz, so they consume none of MB's
/// rate budget - yet awaiting them inline stalled the loop, leaving the limiter idle. ~20k artists in
/// this library still need one, at up to three lookups plus a download each, so that idle time is
/// hours. Spawned via `JoinSet` rather than collected into a `FuturesUnordered`: a local
/// `FuturesUnordered` only advances while you await *it*, which would overlap nothing.
#[allow(clippy::too_many_arguments)]
async fn fetch_and_store_artist_image(
    http_client: Client,
    detail: common::mb::types::MbArtistDetail,
    artist_id: String,
    artist_slug: String,
    artist_name: String,
    s3_client: Option<aws_sdk_s3::Client>,
    config: common::config::Config,
    pool: sqlx::PgPool,
) -> (String, Result<bool, String>) {
    let result = download_artist_image(
        &http_client,
        &detail,
        &artist_slug,
        None,
        &s3_client,
        &config,
    )
    .await;

    if let Ok(true) = result {
        common::images::record_artist_image(&pool, &config, &artist_id, &artist_slug).await;
    }

    (artist_name, result)
}

/// Named because the download no longer lines up with the artist on screen - the result arrives while
/// some later artist is being synced, so the message has to say whose image it was.
pub(crate) fn report_image_result(reporter: &Reporter, name: &str, result: &Result<bool, String>) {
    match result {
        Ok(true) => reporter.sub_ok(&format!("[{}] Artist image downloaded", name)),
        Ok(false) => reporter.sub_step(&format!("[{}] Artist image not found", name)),
        Err(e) => reporter.sub_step(&format!("[{}] Artist image error: {}", name, e)),
    }
}

/// The per-worker pieces `main()`'s concurrent `.map()` closure builds each iteration - a clone of
/// every shared handle (cheap, `Arc`-backed) plus a borrow of everything read-only for the whole run.
pub(crate) struct ArtistWorkerCtx<'a> {
    pub(crate) args: &'a SyncArgs,
    pub(crate) warmed_artist_names: &'a HashMap<String, MbArtistMatch>,
    pub(crate) already_synced: &'a HashSet<String>,
    pub(crate) run_hash: &'a Option<String>,
    pub(crate) target_release_id: &'a Option<String>,
    pub(crate) reporter: Reporter,
    pub(crate) pool: sqlx::PgPool,
    pub(crate) http_client: Client,
    pub(crate) s3_client: Option<aws_sdk_s3::Client>,
    pub(crate) config: Config,
    pub(crate) running: Arc<AtomicBool>,
    pub(crate) limiter: RateLimiter,
    pub(crate) image_tasks: ImageTasks,
    pub(crate) image_slots: Arc<tokio::sync::Semaphore>,
    pub(crate) synced_mb_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    pub(crate) release_group_cache:
        Arc<tokio::sync::Mutex<HashMap<String, Vec<mb_types::MbReleaseGroup>>>>,
}

pub(crate) async fn process_artist(
    i: usize,
    artist: &ArtistSyncRow,
    total: usize,
    ctx: ArtistWorkerCtx<'_>,
) -> ArtistOutcome {
    let ArtistWorkerCtx {
        args,
        warmed_artist_names,
        already_synced,
        run_hash,
        target_release_id,
        reporter,
        pool,
        http_client,
        s3_client,
        config,
        running,
        mut limiter,
        image_tasks,
        image_slots,
        synced_mb_ids,
        release_group_cache,
    } = ctx;
    // Per-worker, not shared: every write behind these caches is an idempotent upsert
    // (`ON CONFLICT (name)`), so a cache miss costs one redundant round trip to a local
    // Postgres and never a wrong row - far cheaper than serialising workers on a shared lock
    // held across a DB await.
    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let mut genre_cache: HashMap<String, String> = HashMap::new();
    let is_targeted = args.release.is_some();
    let r = ArtistReporter::new(&reporter, &artist.name);
    let mut outcome = ArtistOutcome::default();
    if !running.load(Ordering::SeqCst) {
        return outcome;
    }

    if already_synced.contains(&artist.id) {
        return outcome;
    }

    // Skip special artists (Various Artists, [unknown], etc.)
    if is_special_artist_name(&artist.name) {
        reporter.item("", &artist.name, i + 1, total);
        r.skip("Special artist - skipped");
        if let Some(ref h) = run_hash {
            stamp_sync_hash(&pool, &artist.id, h).await;
        }
        return outcome;
    }

    reporter.sync_progress(&artist.name, i + 1, total, "syncing");
    reporter.item("", &artist.name, i + 1, total);
    // Sampled either side of the artist so `--verbose` can report what it cost in MusicBrainz
    // calls. That number is the whole point of the catalogue browse below, and the thing to
    // watch if it ever creeps back up. Approximate under concurrency (the counter is global and
    // other workers advance it too), so it reads as an upper bound, never an undercount.
    let calls_before = limiter.requests_issued();

    let local_releases = match get_local_releases_for_artist(&pool, &artist.id).await {
        Ok(r) => r,
        Err(e) => {
            r.err(&format!("DB error: {}", e));
            return outcome;
        }
    };

    if local_releases.is_empty() {
        r.skip("No local releases - skipped");
        reporter.sync_progress(&artist.name, i + 1, total, "skipped");
        if let Some(ref h) = run_hash {
            stamp_sync_hash(&pool, &artist.id, h).await;
        }
        return outcome;
    }

    // 1. Find artist on MusicBrainz
    let has_mb_id = artist.mb_id.as_ref().is_some_and(|id| !id.is_empty());
    if has_mb_id && !args.overwrite {
        r.step("Looking up artist...");
    } else {
        r.step("Searching MusicBrainz...");
    }

    let mb_artist_opt: Option<MbArtistMatch> = if let Some(ref existing_id) = artist.mb_id {
        if !existing_id.is_empty() && !args.overwrite {
            Some(MbArtistMatch {
                id: existing_id.clone(),
                name: artist.name.clone(),
                score: Some(100),
                aliases: None,
            })
        } else {
            match find_mb_match_with_fallback(
                &http_client,
                &pool,
                &artist.id,
                &artist.name,
                artist.mb_id.as_deref(),
                &mut limiter,
                warmed_artist_names,
            )
            .await
            {
                Ok(result) => result,
                Err(e) => return artist_lookup_failed(&r, outcome, &artist.name, &e),
            }
        }
    } else {
        match find_mb_match_with_fallback(
            &http_client,
            &pool,
            &artist.id,
            &artist.name,
            None,
            &mut limiter,
            warmed_artist_names,
        )
        .await
        {
            Ok(result) => result,
            Err(e) => return artist_lookup_failed(&r, outcome, &artist.name, &e),
        }
    };

    let mb_artist = match mb_artist_opt {
        Some(m) => {
            r.sub_ok(&format!("Found: {} ({})", m.name, m.id));
            m
        }
        None => {
            r.skip("No MB match");
            reporter.sync_progress(&artist.name, i + 1, total, "no_match");
            let now = chrono::Utc::now().naive_utc();
            sqlx::query(
                r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#,
            )
            .bind(now)
            .bind(&artist.id)
            .execute(&pool)
            .await
            .ok();
            if let Some(ref h) = run_hash {
                stamp_sync_hash(&pool, &artist.id, h).await;
            }
            return outcome;
        }
    };

    // Duplicate detection: another artist already resolved to this MB ID.
    //
    // The whole probe-and-claim runs under one lock, **including the `musicbrainzId` persist**, not
    // just the non-duplicate branch's own logic. Both probes ask "has anyone claimed this MB id?",
    // and the DB probe can only answer yes once someone has written the id - so with
    // workers running concurrently, two artists resolving to the same MB id could each probe
    // before either wrote, and both would claim to be primary. Holding the lock across the write
    // makes the claim atomic. It also closes the same read-then-write gap in the serial path.
    let mut is_duplicate = false;
    let mut primary_artist_id: Option<String> = None;
    {
        let mut claimed = synced_mb_ids.lock().await;

        if let Some(prev_id) = claimed.get(&mb_artist.id) {
            if prev_id != &artist.id {
                is_duplicate = true;
                primary_artist_id = Some(prev_id.clone());
            }
        }

        if !is_duplicate {
            // A candidate only outranks this artist if it actually owns local releases. This
            // query had no such condition and no `ORDER BY`, so whichever row Postgres returned
            // first became canonical - which is how a credit-only row with zero releases ended up
            // standing in front of the row holding the whole discography ("Dylan" over "Bob
            // Dylan", "Wardell Gray Quintet" over "Erroll Garner"; 35 cases in this library).
            // This artist is already known to own releases (the empty case returned earlier), so
            // an owner-less candidate can never be the better primary.
            //
            // Among genuine owners, most-owned wins, then an exact match on MusicBrainz's own
            // name for the artist, then lowest id - so the outcome is stable across runs and
            // independent of worker scheduling.
            if let Some((db_primary_id,)) = sqlx::query_as::<_, (String,)>(
                r#"SELECT a.id FROM "Artist" a
                       WHERE a."musicbrainzId" = $1 AND a.id != $2
                         AND a."primaryArtistId" IS NULL
                         AND EXISTS (
                           SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id
                         )
                       ORDER BY (
                         SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id
                       ) DESC, (a.name = $3) DESC, a.id ASC
                       LIMIT 1"#,
            )
            .bind(&mb_artist.id)
            .bind(&artist.id)
            .bind(&mb_artist.name)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            {
                is_duplicate = true;
                primary_artist_id = Some(db_primary_id);
            }
        }

        if !is_duplicate {
            claimed.insert(mb_artist.id.clone(), artist.id.clone());
            // Self-heal rows the old probe mislinked: this artist owns releases, so a primary
            // that owns none is backwards. Swaps the two rather than leaving the discography
            // stranded behind an empty name.
            match promote_over_empty_primary(&pool, &artist.id).await {
                Ok(Some(demoted)) => r.ok(&format!(
                    "Promoted over empty primary artist \"{}\" (it owns no releases)",
                    demoted
                )),
                Ok(None) => {}
                Err(e) => r.warn(&format!("Primary-artist repair failed: {}", e)),
            }
            // Persist MB ID if newly found or changed - part of the claim, not of the work below.
            if artist.mb_id.as_deref() != Some(&mb_artist.id) {
                sqlx::query(
                        r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&mb_artist.id)
                    .bind(&artist.id)
                    .execute(&pool)
                    .await
                    .ok();
            }
        }
    }

    if is_duplicate {
        let primary_id = primary_artist_id.as_ref().unwrap();
        r.step("Connected to primary artist (syncing releases only)");
        sqlx::query(
            r#"UPDATE "Artist" SET "primaryArtistId" = $1, "updatedAt" = NOW()
                   WHERE id = $2 AND "primaryArtistId" IS NULL"#,
        )
        .bind(primary_id)
        .bind(&artist.id)
        .execute(&pool)
        .await
        .ok();
    }

    let (artist_genre_ids, country_code): (Vec<String>, Option<String>) = if is_duplicate {
        let genres = get_artist_genre_ids(&pool, primary_artist_id.as_ref().unwrap()).await;
        (genres, None)
    } else {
        // (the MB ID persist happens under the claim lock above)

        // 2. Artist detail (genres, tags, URLs)
        r.step("Fetching artist details...");
        let detail =
            match mb_api::mb_get_artist_detail(&http_client, &mb_artist.id, &mut limiter).await {
                Ok(d) => d,
                Err(e) => {
                    r.err(&format!("Detail error: {}", e));
                    return outcome;
                }
            };

        let country_code = detail.country_code().map(|s| s.to_string());

        // Upsert genres from MB genres + tags
        let mut artist_genre_ids: Vec<String> = Vec::new();
        if let Some(ref genres) = detail.genres {
            let mut sorted = genres.to_vec();
            sorted.sort_by(|a, b| b.count.unwrap_or(0).cmp(&a.count.unwrap_or(0)));
            for genre in sorted.iter().take(5) {
                if let Ok(id) = ensure_genre_cached(&pool, &genre.name, &mut genre_cache).await {
                    artist_genre_ids.push(id);
                }
            }
        }
        if let Some(ref tags) = detail.tags {
            for t in tags {
                if t.count.unwrap_or(0) > 0 {
                    if let Ok(id) = ensure_genre_cached(&pool, &t.name, &mut genre_cache).await {
                        artist_genre_ids.push(id);
                    }
                }
            }
        }
        artist_genre_ids.sort();
        artist_genre_ids.dedup();
        batch_link_artist_genres(&pool, &artist.id, &artist_genre_ids)
            .await
            .ok();

        // Upsert URLs
        let urls: Vec<(String, String)> = detail
            .relations
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|r| {
                r.url
                    .as_ref()
                    .map(|u| (r.relation_type.clone(), u.resource.clone()))
            })
            .collect();
        batch_upsert_artist_urls(&pool, &artist.id, &urls)
            .await
            .ok();
        r.sub_ok(&format!(
            "Saved {} URLs, {} genres{}",
            urls.len(),
            artist_genre_ids.len(),
            country_code
                .as_deref()
                .map(|c| format!(", country: {}", c))
                .unwrap_or_default()
        ));

        // 3. Artist image - skip if already present. Spawned, not awaited: see
        // `fetch_and_store_artist_image`.
        if !args.skip_artist_img && !artist.has_image {
            let slots = image_slots.clone();
            let fetch = fetch_and_store_artist_image(
                http_client.clone(),
                detail.clone(),
                artist.id.clone(),
                artist.slug.clone(),
                artist.name.clone(),
                s3_client.clone(),
                config.clone(),
                pool.clone(),
            );
            let mut tasks = image_tasks.lock().await;
            // Report whatever has already landed. `try_join_next` never waits, so the lock is
            // held only for as long as the bookkeeping takes.
            while let Some(joined) = tasks.try_join_next() {
                if let Ok((name, result)) = joined {
                    report_image_result(&reporter, &name, &result);
                }
            }
            tasks.spawn(async move {
                let _permit = slots.acquire_owned().await;
                fetch.await
            });
        }

        (artist_genre_ids, country_code)
    };

    // 4. Release groups (cached for duplicates sharing same MB artist). `release_groups_fetch_failed`
    // feeds `is_total_failure` below: a failed fetch must never be indistinguishable from an
    // artist that genuinely has zero release groups on MB, or the artist gets stamped "done" for
    // this run having accomplished nothing (see docs/sync_decisions.md - caught live during the
    // box-set backfill, artists whose only releases lack an embedded MB id never call any other
    // fallible API function, so processed_count and release_failures both stay 0 and the old gate
    // silently marked them complete). Only a successful fetch is cached, so a duplicate artist
    // sharing this MB id doesn't inherit a poisoned empty cache entry either - it retries the
    // fetch itself instead.
    let mut release_groups_fetch_failed = false;
    let cached_release_groups = if is_duplicate {
        release_group_cache.lock().await.get(&mb_artist.id).cloned()
    } else {
        None
    };
    let release_groups = match cached_release_groups {
        Some(rgs) => rgs,
        None => {
            r.step("Fetching releases...");
            match mb_api::mb_get_release_groups(&http_client, &mb_artist.id, &mut limiter).await {
                Ok(rgs) => {
                    release_group_cache
                        .lock()
                        .await
                        .insert(mb_artist.id.clone(), rgs.clone());
                    rgs
                }
                Err(e) => {
                    r.err(&format!("Release groups error: {}", e));
                    release_groups_fetch_failed = true;
                    vec![]
                }
            }
        }
    };

    let mut processed_count = 0u32;
    let mut newly_synced_count = 0u32;
    let mut release_failures = 0u32;
    let mut releases_for_art: Vec<(String, String, String)> = Vec::new();

    let local_release_total = local_releases.len();
    for (lr_idx, local_release) in local_releases.iter().enumerate() {
        if let Some(ref target_id) = target_release_id {
            if local_release.id != *target_id {
                continue;
            }
        }
        if local_release.forced_complete {
            continue;
        }
        let release_start = std::time::Instant::now();
        r.info(&format!(
            "    ({}/{}) - {}",
            lr_idx + 1,
            local_release_total,
            local_release.title,
        ));

        // If already synced and not overwriting, skip the MB API call entirely.
        //
        // UNKNOWN is the exception: index sets it (keeping `releaseId`) when it deletes tracks
        // from a matched release, precisely so the track-count comparison gets redone here.
        // Skipping on `releaseId` alone made that reset a no-op - the release kept a status
        // computed against a tracklist that no longer exists until someone ran `--overwrite`.
        let needs_recalc = local_release.match_status.as_deref() == Some("UNKNOWN");
        if !args.overwrite && !needs_recalc {
            if let Some(ref existing_mb_db_id) = local_release.release_id {
                ensure_mb_release_artist_link(&pool, existing_mb_db_id, &artist.id)
                    .await
                    .ok();
                batch_link_release_genres(&pool, existing_mb_db_id, &artist_genre_ids)
                    .await
                    .ok();
                processed_count += 1;
                if args.verbose {
                    r.skip(&format!("{} (already synced)", local_release.title));
                }
                continue;
            }
        }

        let local_tracks = match get_local_tracks_for_release(&pool, &local_release.id).await {
            Ok(t) => t,
            Err(_) => continue,
        };

        // No-guessing release placement gate (docs/no_guessing.md). Unanimous only - never a
        // plurality/majority vote. Exempt cases don't get their placement from tags at all:
        //
        // - a dissolved box disc's files are still tagged with the *box's* id, so the gate (and
        //   the tiers below) would fight the box pass over where it belongs - the disc then never
        //   settles on a score, which is what left ABBA's nine-disc box showing unscored discs
        //   across three consecutive syncs. The dissolve decides (docs/sync_decisions.md).
        // - a folded multi-disc survivor legitimately mixes each disc's own album tags.
        let exempt = local_release.dissolved_bound_mb_id.is_some() || local_release.is_folded;
        let verdict = consensus::evaluate(&consensus_tags_from_rows(&local_tracks));
        if !exempt {
            if let Some(reason) = verdict.reason {
                consensus::mark_local_release_unknown(&pool, &local_release.id, reason)
                    .await
                    .ok();
                r.skip(&format!("{} ({})", local_release.title, reason));
                continue;
            }
        }

        // 4-tier matching: the verdict's unanimous ids, never a vote. A dissolved box disc keeps
        // scoring against the box's id regardless of what its tags say (see the gate above).
        let tier1_release_id = local_release
            .dissolved_bound_mb_id
            .clone()
            .or(verdict.mb_release_id.clone());
        let tier2_rg_id = verdict.mb_release_group_id.clone();

        // Tier 1: Direct release lookup via embedded MUSICBRAINZ_ALBUMID
        let mut matched: Option<MatchCandidate> = None;
        if let Some(ref rel_id) = tier1_release_id {
            let api_start = std::time::Instant::now();
            r.info(&format!("        → Lookup by album ID {}", rel_id));
            match mb_api::mb_get_release_by_id(&http_client, rel_id, &mut limiter).await {
                Ok(found) => {
                    r.info(&format!(
                        "        ← Found release in {:.1}s ({} tracks)",
                        api_start.elapsed().as_secs_f64(),
                        found.tracks.len()
                    ));
                    matched = Some(MatchCandidate {
                        release_id: rel_id.clone(),
                        rg_id: found.rg_id,
                        releases: vec![(found.release, found.tracks)],
                        primary_type: found.primary_type,
                        secondary_types: found.secondary_types,
                        from_tags: true,
                    });
                }
                Err(e) if mb_api::classify_mb_error(&e) == mb_api::MbErrorKind::NotFound => {
                    r.info("        ← Album ID not found, trying release group...");
                }
                Err(e) if mb_api::classify_mb_error(&e) == mb_api::MbErrorKind::Transient => {
                    r.warn(&format!(
                        "{}: MB unavailable, skipping",
                        local_release.title
                    ));
                    continue;
                }
                Err(e) => {
                    release_failures += 1;
                    r.err(&format!("{}: {}", local_release.title, e));
                    continue;
                }
            }
        }

        // Tier 2: Release group lookup via MUSICBRAINZ_RELEASEGROUPID. Also the Tier 1 404
        // fallback: the verdict's release-group id is the same one Tier 1's release would have
        // browsed to, so a 404 on Tier 1 falls straight through to trying it here - no special
        // casing needed.
        if matched.is_none() {
            if let Some(ref rg_id) = tier2_rg_id {
                let api_start = std::time::Instant::now();
                r.info(&format!(
                    "        → Browse release group {} (all editions)",
                    rg_id
                ));
                match mb_api::mb_get_release_tracks(&http_client, rg_id, &mut limiter).await {
                    Ok(releases) if !releases.is_empty() => {
                        r.info(&format!(
                            "        ← Found {} edition(s) in {:.1}s",
                            releases.len(),
                            api_start.elapsed().as_secs_f64(),
                        ));
                        let rg = release_groups.iter().find(|rg2| &rg2.id == rg_id);
                        let primary_type = rg.and_then(|rg2| rg2.primary_type.clone());
                        let secondary_types = rg
                            .and_then(|rg2| rg2.secondary_types.clone())
                            .unwrap_or_default();
                        matched = Some(MatchCandidate {
                            release_id: String::new(),
                            rg_id: rg_id.clone(),
                            releases,
                            primary_type,
                            secondary_types,
                            from_tags: true,
                        });
                    }
                    Ok(_) => {
                        if args.verbose {
                            r.skip(&format!(
                                "{} (no official releases in group)",
                                local_release.title
                            ));
                        }
                    }
                    Err(e) if mb_api::classify_mb_error(&e) == mb_api::MbErrorKind::Transient => {
                        r.warn(&format!(
                            "{}: MB unavailable, skipping",
                            local_release.title
                        ));
                        continue;
                    }
                    Err(e) => {
                        release_failures += 1;
                        r.err(&format!("{}: {}", local_release.title, e));
                        continue;
                    }
                }
            }
        }

        // Tier 3 (search fallback): only when the local release carries NO usable embedded MB id
        // (e.g. a compilation whose tracks are tagged with their original sources, so there is no
        // unanimous release/release-group id). Search MB by album title + artist, and accept a
        // candidate ONLY if its title is similar to the local album, it is an allowed type, and
        // (downstream) an edition's track count matches. The embedded-id tiers always win first;
        // this never overrides an id, and check_release_status still picks the edition by track
        // count, so distinct editions are not collapsed.
        // Reachable only with a unanimous album title (the gate above already rejected anything
        // else) - which is exactly the evidence a title search needs.
        let has_embedded_ids = tier1_release_id.is_some() || tier2_rg_id.is_some();
        if matched.is_none() && !has_embedded_ids {
            match search_release_candidate(
                &http_client,
                &mut limiter,
                &r,
                &local_release.title,
                &artist.name,
                args.verbose,
            )
            .await
            {
                SearchOutcome::Found(candidate) => matched = Some(candidate),
                SearchOutcome::NotFound => {}
                SearchOutcome::Transient => {
                    r.warn(&format!(
                        "{}: MB unavailable, skipping",
                        local_release.title
                    ));
                    continue;
                }
            }
        }

        // Strict policy: metadata wins. No usable MB metadata (embedded id or confident search) →
        // leave Unmatched. The former blanket "no fuzzy matching" is now the guarded Tier 3 above.
        let mut candidate = match matched {
            Some(m) => m,
            None => {
                mark_local_release_unmatched(&pool, &local_release.id)
                    .await
                    .ok();
                if args.verbose {
                    r.skip(&format!(
                        "{} (no MB metadata in tags - left Unmatched)",
                        local_release.title
                    ));
                }
                continue;
            }
        };

        let local_track_ids: Vec<String> = local_tracks.iter().map(|t| t.id.clone()).collect();
        let local_metas: Vec<TrackMeta> = status::track_metas_from_rows(&local_tracks);
        let local_meta_refs: Vec<&TrackMeta> = local_metas.iter().collect();

        // Score the candidate, and - when the tags point at something the library refuses to bind -
        // give the search tier one shot at an allowed edition before giving up. The tagged ids win
        // whenever they are usable; this only runs after they have already been rejected, which is
        // how a folder tagged with a bootleg's release id (or one MusicBrainz files under a Single
        // group) can still find its official album instead of sitting Unmatched forever.
        let mut searched_fallback = false;
        let scored = loop {
            let status_check = check_release_status(
                &local_meta_refs,
                &local_track_ids,
                &candidate.releases,
                local_release.year,
                local_release.medium_position,
            );

            // Strict policy: when a release-group lookup returned multiple siblings and
            // none (or several) match the local track count, refuse to bind a specific
            // edition. Leave the LocalRelease Unmatched so the user can disambiguate
            // by tagging the files with the correct MUSICBRAINZ_ALBUMID.
            if !status_check.is_confident {
                mark_local_release_unmatched(&pool, &local_release.id)
                    .await
                    .ok();
                r.skip(&format!(
                    "{} ({} MB siblings, no exact track-count match - left Unmatched)",
                    local_release.title,
                    candidate.releases.len()
                ));
                break None;
            }

            // Allow-list gate: album-oriented library, no singles. Reject any release whose group
            // is not Album/EP, whose secondary type is non-music, or whose status is not Official.
            let best_status = candidate.releases[status_check.best_release_idx]
                .0
                .status
                .clone();
            let gate = if candidate.from_tags {
                common::mb::allowlist::is_allowed_tagged
            } else {
                common::mb::allowlist::is_allowed
            };
            if gate(
                candidate.primary_type.as_deref(),
                &candidate.secondary_types,
                best_status.as_deref(),
            ) {
                break Some(status_check);
            }

            if has_embedded_ids && !searched_fallback {
                searched_fallback = true;
                r.info(&format!(
                        "        → Tagged release is not bindable (type={}, status={}) - searching for an allowed edition",
                        candidate.primary_type.as_deref().unwrap_or("?"),
                        best_status.as_deref().unwrap_or("?"),
                    ));
                if let SearchOutcome::Found(found) = search_release_candidate(
                    &http_client,
                    &mut limiter,
                    &r,
                    &local_release.title,
                    &artist.name,
                    args.verbose,
                )
                .await
                {
                    candidate = found;
                    continue;
                }
            }

            mark_local_release_unmatched(&pool, &local_release.id)
                .await
                .ok();
            r.skip(&format!(
                "{} (not allowed: type={}, status={} - left Unmatched)",
                local_release.title,
                candidate.primary_type.as_deref().unwrap_or("?"),
                best_status.as_deref().unwrap_or("?"),
            ));
            break None;
        };

        let status_check = match scored {
            Some(s) => s,
            None => continue,
        };

        let MatchCandidate {
            release_id: tier_release_id,
            rg_id,
            releases: mb_release_tracks,
            primary_type,
            secondary_types,
            from_tags: _,
        } = candidate;
        let status_str = status_to_db_string(&status_check.status);

        let type_name = primary_type.clone().unwrap_or_else(|| "Other".to_string());
        let type_id =
            match ensure_release_type_cached(&pool, &type_name, &mut release_type_cache).await {
                Ok(id) => id,
                Err(_) => continue,
            };

        let year = release_groups
            .iter()
            .find(|rg| rg.id == rg_id)
            .and_then(|rg| rg.first_release_date.as_deref())
            .or_else(|| mb_release_tracks[0].0.date.as_deref())
            .and_then(|d| d.split('-').next())
            .and_then(|y| y.parse::<i32>().ok());

        let best_release = &mb_release_tracks[status_check.best_release_idx].0;
        let best_tracks = &mb_release_tracks[status_check.best_release_idx].1;

        // Use Tier 1 release ID if available, otherwise use best match from status check
        let final_release_id = if !tier_release_id.is_empty() {
            tier_release_id
        } else {
            status_check.best_release_id.clone()
        };
        let disambiguation = status_check.best_release_disambiguation.as_deref();
        let format_str = format_from_media(&best_release.media);
        let rg_first_date = release_groups
            .iter()
            .find(|rg| rg.id == rg_id)
            .and_then(|rg| rg.first_release_date.as_deref());
        let edition_label = synthesize_edition_label(best_release, rg_first_date);
        let extras = MbReleaseExtras {
            edition_label: edition_label.as_deref(),
            release_date: best_release.date.as_deref(),
            packaging: best_release.packaging.as_deref(),
            country: best_release.country.as_deref(),
            format: format_str.as_deref(),
            release_group_secondary_types: &secondary_types,
        };

        let medium_rows = mb_medium_rows(&best_release.media);
        let mb_db_id = match upsert_mb_release_with_media(
            &pool,
            &final_release_id,
            &rg_id,
            &best_release.title,
            year,
            &type_id,
            status_str,
            None,
            disambiguation,
            &extras,
            medium_rows.len().max(1) as i32,
        )
        .await
        {
            Ok(id) => id,
            Err(e) => {
                release_failures += 1;
                r.err(&format!("{}: DB error: {}", local_release.title, e));
                continue;
            }
        };
        sync_mb_media_for_release(&pool, &mb_db_id, &medium_rows)
            .await
            .ok();

        // (Removed) shared-releaseId guard: it unmatched any LocalRelease whose MB release was
        // already bound to another LocalRelease. That was a band-aid for the old fragmentation
        // matcher; with folder-grouping, multiple LocalReleases legitimately map to one MB release
        // (duplicate folder-copies of the same album), so the guard wrongly blocked them. Duplicate
        // copies are now surfaced by the duplicate-release audit rule instead of blocked here.

        ensure_mb_release_artist_link(&pool, &mb_db_id, &artist.id)
            .await
            .ok();

        let track_rows: Vec<MbTrackRow> = best_tracks
            .iter()
            .map(|t| MbTrackRow {
                title: t.title.clone(),
                position: t.position.map(|p| p as i32),
                disc_number: t.disc_number.map(|d| d as i32),
                duration_ms: t.length.map(|l| l as i32),
                mb_id: Some(t.id.clone()),
                recording_id: t.recording.as_ref().map(|r| r.id.clone()),
            })
            .collect();

        let inserted_tracks = match sync_mb_tracks_for_release(&pool, &mb_db_id, &track_rows).await
        {
            Ok(t) => t,
            Err(e) => {
                release_failures += 1;
                r.warn(&format!(
                    "{}: track insert failed: {}",
                    local_release.title, e
                ));
                continue;
            }
        };

        let track_links: Vec<(String, String)> = status_check
            .matched_mb_tracks
            .iter()
            .filter_map(|(mb_track, local_id_opt)| {
                let local_id = local_id_opt.as_ref()?;
                let db_id = inserted_tracks
                    .iter()
                    .find(|(_, mid)| mid.as_deref() == Some(mb_track.id.as_str()))
                    .map(|(db_id, _)| db_id.clone())?;
                Some((local_id.clone(), db_id))
            })
            .collect();
        if let Err(e) = bind_local_release(
            &pool,
            &local_release.id,
            &mb_db_id,
            status_str,
            &track_links,
        )
        .await
        {
            release_failures += 1;
            r.warn(&format!("{}: bind failed: {}", local_release.title, e));
            continue;
        }

        batch_link_release_genres(&pool, &mb_db_id, &artist_genre_ids)
            .await
            .ok();

        if !args.skip_mb_tags {
            let music_dir = config.music_dir.as_deref().unwrap_or("");
            if !music_dir.is_empty() {
                let mut local_to_mb_track: HashMap<&str, (&str, Option<&str>)> = HashMap::new();
                for (mb_track, local_id_opt) in &status_check.matched_mb_tracks {
                    if let Some(local_id) = local_id_opt {
                        local_to_mb_track.insert(
                            local_id.as_str(),
                            (
                                mb_track.id.as_str(),
                                mb_track.recording.as_ref().map(|r| r.id.as_str()),
                            ),
                        );
                    }
                }

                if let Ok(id_paths) =
                    get_track_id_file_paths_for_release(&pool, &local_release.id).await
                {
                    let mut tags_written = 0u32;
                    for (track_id, rel_path) in &id_paths {
                        let abs_path = std::path::Path::new(music_dir).join(rel_path);
                        if !abs_path.exists() {
                            continue;
                        }
                        let (release_track, recording) = local_to_mb_track
                            .get(track_id.as_str())
                            .copied()
                            .map_or((None, None), |(rt, rec)| (Some(rt), rec));
                        let ids = common::tags::MbTagIds {
                            album_artist: Some(&mb_artist.id),
                            album: Some(&final_release_id),
                            release_group: Some(&rg_id),
                            release_track,
                            recording,
                        };
                        match common::tags::write_mb_ids(&abs_path, &ids, args.overwrite) {
                            Ok(true) => {
                                tags_written += 1;
                            }
                            Ok(false) => {}
                            Err(e) => {
                                if args.verbose {
                                    r.warn(&format!("MB tag write {}: {}", rel_path, e));
                                }
                            }
                        }
                    }
                    if tags_written > 0 {
                        r.info(&format!(
                            "        ↳ Wrote MB IDs to {}/{} tracks",
                            tags_written,
                            id_paths.len()
                        ));
                    }
                }
            }
        }

        if !args.skip_release_img && !local_release.has_cover {
            releases_for_art.push((
                final_release_id.clone(),
                rg_id.clone(),
                local_release.id.clone(),
            ));
        }

        if args.verbose {
            let status_label = match status_check.status {
                status::ReleaseStatus::Complete => "Complete",
                status::ReleaseStatus::ExtraTracks => "Extra tracks",
                status::ReleaseStatus::MissingTracks => "Missing tracks",
                status::ReleaseStatus::Incomplete => "Incomplete",
            };
            r.sub_ok(&format!(
                "{} - {} ({} local / {} MB tracks)",
                local_release.title,
                status_label,
                local_tracks.len(),
                best_tracks.len(),
            ));
        }
        processed_count += 1;
        newly_synced_count += 1;
        r.info(&format!(
            "        ✓ {} done in {:.1}s",
            local_release.title,
            release_start.elapsed().as_secs_f64()
        ));
    }

    // Catalogue gaps: persist MISSING entries for MB release groups without local releases
    if !release_groups.is_empty() && !is_targeted && !is_duplicate {
        let covered_rg_ids = get_covered_release_group_ids(&pool, &artist.id).await;
        if let Err(ref e) = covered_rg_ids {
            r.warn(&format!(
                "Owned release groups unreadable: {} - gaps skipped",
                e
            ));
        }
        // A release group has no status, so the allow-list alone lets bootleg live recordings in
        // (primary Album, secondary Live - both kept on purpose for official live albums). Ask MB
        // which of this artist's groups actually have an Official release. On failure, leave the
        // existing MISSING rows alone rather than rewriting the catalogue from unfiltered data.
        // One browse, two answers: the official-group set this gate needs, and the tracklist of
        // every one of those releases - which is what the containment note below is derived from,
        // instead of spending a separate paginated browse per gap here on every run.
        let catalogue = match covered_rg_ids {
            Err(_) => None,
            Ok(_) => match mb_api::mb_get_official_artist_catalogue(
                &http_client,
                &mb_artist.id,
                &mut limiter,
            )
            .await
            {
                Ok(c) => Some(c),
                Err(e) => {
                    r.warn(&format!(
                        "Official release lookup failed: {} - gaps skipped",
                        e
                    ));
                    None
                }
            },
        };
        if let (Some(catalogue), Ok(covered_rg_ids)) = (catalogue, covered_rg_ids) {
            let official_rg_ids = &catalogue.official_rg_ids;
            // Notes survive the wipe below. Re-deriving one is free now (the catalogue above
            // already carries the tracklists), but the carried note still wins on a non-overwrite
            // run so an existing annotation is never churned.
            let contained_notes = get_contained_notes_for_artist(&pool, &artist.id).await;
            delete_missing_releases_for_artist(&pool, &artist.id)
                .await
                .ok();
            // Candidate containers for the "recordings already inside another release" note.
            let local_bundles = get_local_bundles_for_artist(&pool, &artist.id).await;
            let mut gap_count = 0u32;
            let mut contained_count = 0u32;
            for rg in &release_groups {
                if covered_rg_ids.contains(&rg.id) {
                    continue;
                }
                // Album-oriented allow-list, plus proof the group has an Official release.
                let secondary = rg.secondary_types.clone().unwrap_or_default();
                if !common::mb::allowlist::is_allowed_gap(
                    rg.primary_type.as_deref(),
                    &secondary,
                    &rg.id,
                    official_rg_ids,
                ) {
                    continue;
                }
                // The recordings may already sit inside a bigger local release (a box set, a
                // compilation, a two-disc folder). That is not ownership of *this* release, so it
                // stays a gap - we only note where they are (see `owned.rs`). Editions come from
                // the catalogue browse above; `is_allowed_gap` has just proved this group has an
                // Official release, so the entry is always present.
                let contained_note = match contained_notes.get(&rg.id) {
                    Some(note) if !args.overwrite => Some(note.clone()),
                    _ => owned::detect_containment(
                        catalogue.editions_by_rg.get(&rg.id).map_or(&[][..], |v| v),
                        &local_bundles,
                    )
                    .map(|container| owned::containment_note(&container)),
                };
                if let Some(note) = &contained_note {
                    contained_count += 1;
                    r.info(&format!("        · {} - {}", rg.title, note));
                }
                let type_name = rg.primary_type.as_deref().unwrap_or("Other");
                let type_id =
                    match ensure_release_type_cached(&pool, type_name, &mut release_type_cache)
                        .await
                    {
                        Ok(id) => id,
                        Err(_) => continue,
                    };
                let year = rg
                    .first_release_date
                    .as_deref()
                    .and_then(|d| d.split('-').next())
                    .and_then(|y| y.parse::<i32>().ok());
                let extras = MbReleaseExtras {
                    release_date: rg.first_release_date.as_deref(),
                    release_group_secondary_types: rg
                        .secondary_types
                        .as_deref()
                        .unwrap_or_default(),
                    ..Default::default()
                };
                if let Ok(mb_db_id) = upsert_mb_release(
                    &pool,
                    &rg.id,
                    &rg.id,
                    &rg.title,
                    year,
                    &type_id,
                    "MISSING",
                    contained_note.as_deref(),
                    None,
                    &extras,
                )
                .await
                {
                    ensure_mb_release_artist_link(&pool, &mb_db_id, &artist.id)
                        .await
                        .ok();
                    batch_link_release_genres(&pool, &mb_db_id, &artist_genre_ids)
                        .await
                        .ok();
                    gap_count += 1;
                }
            }
            if gap_count > 0 {
                r.ok(&format!(
                    "{} missing release(s) appended to catalogue",
                    gap_count
                ));
            }
            if contained_count > 0 {
                r.ok(&format!(
                    "{} gap(s) noted as recordings already inside another release",
                    contained_count
                ));
            }
        }
    }

    if !releases_for_art.is_empty() {
        let music_dir = config.music_dir.as_deref().unwrap_or("");
        let release_img_dir = std::path::PathBuf::from(&config.image_dir).join("releases");
        r.step(&format!(
            "Downloading cover art ({} releases)...",
            releases_for_art.len()
        ));
        let mut art_downloaded = 0u32;
        for (rel_id, rg_id, local_release_id) in &releases_for_art {
            let art_start = std::time::Instant::now();
            match download_cover_art(&http_client, rel_id, rg_id).await {
                Ok(Some(jpeg_bytes)) => {
                    art_downloaded += 1;

                    // Embed cover art into each track's audio file metadata
                    let mut embedded = 0u32;
                    if !music_dir.is_empty() {
                        if let Ok(file_paths) =
                            get_track_file_paths_for_release(&pool, local_release_id).await
                        {
                            for fp in &file_paths {
                                let abs_path = std::path::Path::new(music_dir).join(fp);
                                match common::images::embed_cover_art(&abs_path, &jpeg_bytes) {
                                    Ok(true) => {
                                        embedded += 1;
                                    }
                                    Ok(false) => {}
                                    Err(e) => {
                                        r.warn(&format!("Embed art {}: {}", fp, e));
                                    }
                                }
                            }
                            if embedded > 0 {
                                r.info(&format!(
                                    "      ↳ Embedded cover into {}/{} tracks",
                                    embedded,
                                    file_paths.len()
                                ));

                                let thumb_path =
                                    release_img_dir.join(format!("{}.jpg", local_release_id));
                                let extracted = file_paths.iter().any(|fp| {
                                    let abs_path = std::path::Path::new(music_dir).join(fp);
                                    common::images::extract_cover_art(&abs_path, &thumb_path)
                                });

                                if extracted {
                                    if config.use_local() {
                                        let filename = format!("{}.jpg", local_release_id);
                                        sqlx::query(
                                                r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                            )
                                            .bind(&filename)
                                            .bind(local_release_id)
                                            .execute(&pool)
                                            .await
                                            .ok();
                                    }
                                    if config.use_s3() {
                                        if let (
                                            Some(ref client),
                                            Some(ref bucket),
                                            Some(ref public_url),
                                        ) = (
                                            &s3_client,
                                            &config.storage_bucket,
                                            &config.storage_public_url,
                                        ) {
                                            common::images::upload_release_image_to_s3(
                                                client,
                                                bucket,
                                                public_url,
                                                &pool,
                                                local_release_id,
                                                local_release_id,
                                                &thumb_path,
                                            )
                                            .await;
                                            if !config.use_local() {
                                                std::fs::remove_file(&thumb_path).ok();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    r.info(&format!(
                        "      ↓ {} cover in {:.1}s",
                        rg_id,
                        art_start.elapsed().as_secs_f64()
                    ));
                }
                Ok(None) => {}
                Err(e) => r.warn(&format!("Cover art {}: {}", rg_id, e)),
            }
        }
        if art_downloaded > 0 {
            r.ok(&format!("Downloaded {} cover(s)", art_downloaded));
        }
    }

    reporter.clear_transient();

    if is_duplicate {
        let now = chrono::Utc::now().naive_utc();
        sqlx::query(r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#)
            .bind(now)
            .bind(&artist.id)
            .execute(&pool)
            .await
            .ok();
    } else {
        update_artist_sync_stats(
            &pool,
            &artist.id,
            &mb_artist.id,
            country_code.as_deref(),
            !release_groups_fetch_failed,
        )
        .await
        .ok();
        // Recompute catalogue-completeness now that this artist's MISSING gaps have been (re)written.
        recompute_artist_completeness(&pool, &artist.id).await.ok();
    }

    if !is_targeted {
        if let Ok(n) = cleanup_empty_connected_artists(&pool, &mb_artist.id, &artist.id).await {
            if n > 0 {
                r.info(&format!("Cleaned up {} empty connected artist(s)", n));
            }
        }
    }

    let is_total_failure = is_artist_total_failure(
        processed_count,
        release_failures,
        release_groups_fetch_failed,
    );
    if !is_total_failure {
        if let Some(ref h) = run_hash {
            stamp_sync_hash(&pool, &artist.id, h).await;
        }
    }

    if processed_count > 0 && release_failures == 0 {
        if newly_synced_count > 0 {
            r.ok(&format!("Synced {} release(s)", newly_synced_count));
        } else {
            r.skip(&format!("{} release(s) up to date", processed_count));
        }
        outcome.synced = true;
    } else if processed_count > 0 {
        r.warn(&format!(
            "{} release(s) synced, {} failed",
            newly_synced_count, release_failures
        ));
        outcome.partial = true;
    } else if release_failures > 0 {
        r.err("Failed to sync");
        outcome.failed = Some((
            artist.name.clone(),
            format!("{} error(s)", release_failures),
        ));
    } else {
        r.skip("No releases matched");
    }
    if args.verbose {
        r.info(&format!(
            "        · {} MusicBrainz call(s) for this artist",
            limiter.requests_issued().saturating_sub(calls_before)
        ));
    }
    reporter.sync_progress(&artist.name, i + 1, total, "done");
    // update_statistics is 13 full-table aggregate scans - throttle to every 50 artists instead of
    // every synced one. The guaranteed call after the loop always catches the tail.
    if newly_synced_count > 0 && i.is_multiple_of(50) {
        update_statistics(&pool).await.ok();
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::{is_artist_total_failure, year_from_date};

    #[test]
    fn year_from_date_takes_the_leading_year() {
        assert_eq!(year_from_date("1975-03-01"), Some(1975));
        assert_eq!(year_from_date("1975"), Some(1975));
        assert_eq!(year_from_date(""), None);
        assert_eq!(year_from_date("abcd-01"), None);
    }

    #[test]
    fn total_failure_when_every_release_actively_failed() {
        assert!(is_artist_total_failure(0, 3, false));
    }

    #[test]
    fn not_total_failure_when_something_processed_despite_other_failures() {
        assert!(!is_artist_total_failure(2, 1, false));
    }

    #[test]
    fn not_total_failure_when_nothing_processed_and_nothing_failed() {
        // A real "artist has zero release groups on MB" outcome - not a failure.
        assert!(!is_artist_total_failure(0, 0, false));
    }

    #[test]
    fn total_failure_when_release_groups_fetch_itself_failed_even_with_zero_release_failures() {
        // docs/sync_decisions.md: an artist whose only local releases have no embedded MB id never
        // calls a per-release API function, so release_failures stays 0 even though the artist
        // accomplished nothing this run - the old gate stamped it "done" regardless.
        assert!(is_artist_total_failure(0, 0, true));
    }

    #[test]
    fn not_total_failure_when_release_groups_fetch_failed_but_something_still_processed() {
        // A duplicate artist reusing a cached (successful, from a prior artist) release-group list,
        // or a release matched via embedded id despite the group-list fetch failing.
        assert!(!is_artist_total_failure(1, 0, true));
    }

    use super::search_match_acceptable;

    #[test]
    fn search_accepts_strong_similar_album() {
        assert!(search_match_acceptable(
            95,
            "Crooning Blackbird",
            "Crooning Blackbird",
            Some("Album"),
            &[]
        ));
        // Similar-but-not-identical title (subtitle) still passes names_are_similar.
        assert!(search_match_acceptable(
            90,
            "A Centenary Celebration",
            "A Centenary Celebration (Remastered)",
            Some("Album"),
            &["Compilation".into()]
        ));
    }

    #[test]
    fn search_rejects_low_score_wrong_title_or_bad_type() {
        // Low MB score.
        assert!(!search_match_acceptable(
            70,
            "Crooning Blackbird",
            "Crooning Blackbird",
            Some("Album"),
            &[]
        ));
        // Dissimilar title (a wrong hit).
        assert!(!search_match_acceptable(
            95,
            "Totally Different Record",
            "Crooning Blackbird",
            Some("Album"),
            &[]
        ));
        // Disallowed type (Single) even with a perfect title.
        assert!(!search_match_acceptable(
            95,
            "Crooning Blackbird",
            "Crooning Blackbird",
            Some("Single"),
            &[]
        ));
    }
}
