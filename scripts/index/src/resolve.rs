//! The artist-resolution pass: decide, for every tag string in the library, which artists it names -
//! and then make the DB say so.
//!
//! Runs after the folder loop rather than inside it, for two reasons: the scan stays fully offline and
//! fast, and resolution can be restarted independently (`--resolve-artists`) without re-reading a
//! single audio file.
//!
//! Cost control, in order of preference:
//!   * tier 0 - `artists[]` / `mbArtistIds[]` pairs already in the file (Picard did the work): free
//!   * cache   - `MbArtistLookup`, hits AND misses, so a name is asked at most once per TTL
//!   * network - MusicBrainz, at ~1.1 req/s
//!
//! Only names that survive to the network cost anything, and each distinct name costs once, ever.

use std::collections::{HashMap, HashSet};

use common::artists::is_special_artist_name;
use common::mb::api::{mb_search_artist_exact, RateLimiter};
use common::mb::names::normalize_name;
use common::progress::Reporter;
use common::mb::resolve::{
    cap_co_owners, resolve_with, JoinKind, LookupResult, Resolution, ResolveSource, ResolvedArtist,
};
use common::slug::make_slug;
use reqwest::Client;
use sqlx::PgPool;

/// How long a *negative* lookup stays trusted. MusicBrainz gains artists continuously, so a "no such
/// artist" answer is re-checked eventually - but not on every run, which is the whole point of caching
/// misses.
const NEGATIVE_TTL_DAYS: i64 = 30;

#[derive(Debug, Default, Clone)]
pub struct ResolveStats {
    pub names_seen: usize,
    pub from_embedded: usize,
    pub from_cache: usize,
    pub from_mb_whole: usize,
    pub from_mb_span: usize,
    pub from_fallback: usize,
    pub deferred: usize,
    pub mb_lookups: usize,
    pub credit_artists_created: usize,
}

/// One name's outcome, for the dry-run report.
pub struct Decision {
    pub name: String,
    pub source: ResolveSource,
    pub parts: Vec<ResolvedArtist>,
}

pub struct ArtistResolver<'a> {
    pool: &'a PgPool,
    client: Client,
    limiter: RateLimiter,
    /// Per-run memo, so a name repeated across 40k tracks is looked at once.
    memo: HashMap<String, LookupResult>,
    pub dry_run: bool,
    pub offline: bool,
    pub stats: ResolveStats,
}

impl<'a> ArtistResolver<'a> {
    pub fn new(pool: &'a PgPool, dry_run: bool) -> Self {
        Self {
            pool,
            // Timeout deliberately matched to sync and problems: `Client::new()` has none, so a stalled
            // MusicBrainz connection hung the whole pass instead of taking the deferred path below.
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            limiter: RateLimiter::new(),
            memo: HashMap::new(),
            dry_run,
            offline: false,
            stats: ResolveStats::default(),
        }
    }

    /// Seed the memo from the whole cache table in one query.
    ///
    /// Deliberately the whole table, not just the tag values being resolved. The span search takes a
    /// compound like `"Gordon Ashworth & Julie Byrne"` apart and asks about the *atoms* inside it, and
    /// those atoms are not themselves distinct tag values - so warming by name left every one of them a
    /// memo miss and sent the resolver to MusicBrainz for an answer already sitting in this table.
    /// Measured on the live library: a 3-minute run made 57 network lookups and inserted 0 new rows,
    /// i.e. every request re-asked a name it already knew. The table is one row per distinct artist
    /// name (~44k), so loading it whole costs a few MB - the folder scan already does exactly this.
    pub async fn warm_cache(&mut self) {
        let rows: Vec<(String, Option<String>, bool)> = sqlx::query_as(
            r#"SELECT name, mbid, ("mbid" IS NULL AND "checkedAt" < NOW() - ($1 || ' days')::interval) AS stale
               FROM "MbArtistLookup""#,
        )
        .bind(NEGATIVE_TTL_DAYS.to_string())
        .fetch_all(self.pool)
        .await
        .unwrap_or_default();

        for (name, mbid, stale) in rows {
            // A stale miss is simply not seeded - it gets re-asked.
            if mbid.is_none() && stale {
                continue;
            }
            let result = match mbid {
                Some(id) => LookupResult::Found { mbid: Some(id) },
                None => LookupResult::NotFound,
            };
            self.memo.insert(name, result);
        }
    }

    /// Cache every answer, even during a dry run. The lookup cache is derived data, not the user's
    /// library: a preview that re-asked MusicBrainz for all 59k names and then made the real run pay
    /// for them again would waste hours at 1.1 req/s. Dry run still writes no artists, links or
    /// credits - see `resolve_and_apply`.
    async fn persist_lookup(&self, name: &str, result: &LookupResult, mb_name: Option<String>) {
        let (mbid, mb_name) = match result {
            LookupResult::Found { mbid } => (mbid.clone(), mb_name),
            LookupResult::NotFound => (None, None),
            // Never cache an unknown - it isn't an answer.
            LookupResult::Transient | LookupResult::NeedsFetch => return,
        };
        sqlx::query(
            r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, "mbName", "checkedAt")
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (name) DO UPDATE SET
                 mbid = EXCLUDED.mbid, "mbName" = EXCLUDED."mbName", "checkedAt" = NOW()"#,
        )
        .bind(cuid2::create_id())
        .bind(name)
        .bind(normalize_name(name))
        .bind(mbid)
        .bind(mb_name)
        .execute(self.pool)
        .await
        .ok();
    }

    async fn fetch(&mut self, name: &str) -> LookupResult {
        if self.offline {
            return LookupResult::Transient;
        }
        self.stats.mb_lookups += 1;
        // MB's own spelling of the name, kept so the cache row records what was matched rather than
        // leaving `mbName` permanently NULL.
        let mut mb_name: Option<String> = None;
        let result = match mb_search_artist_exact(&self.client, name, &mut self.limiter).await {
            Ok(Some(m)) => {
                mb_name = Some(m.name);
                LookupResult::Found { mbid: Some(m.id) }
            }
            Ok(None) => LookupResult::NotFound,
            Err(e) => {
                // A transient failure must never be recorded as "no such artist", or one network blip
                // permanently splits a real band name.
                match common::mb::api::classify_mb_error(&e) {
                    common::mb::api::MbErrorKind::NotFound => LookupResult::NotFound,
                    _ => {
                        common::error_log::log_warn(&format!(
                            "artist lookup deferred for '{}': {}",
                            name, e
                        ));
                        LookupResult::Transient
                    }
                }
            }
        };
        self.persist_lookup(name, &result, mb_name).await;
        self.memo.insert(name.to_string(), result.clone());
        result
    }

    /// Is this tag value already fully answered by the cache? See [`is_fully_memoized`].
    pub fn is_cached(&self, name: &str) -> bool {
        is_fully_memoized(&self.memo, name)
    }

    /// Transient MusicBrainz 503s this run retried through. Not failures - see the run summary.
    pub fn absorbed_503s(&self) -> u64 {
        self.limiter.absorbed_503s
    }

    /// Phase A: ask MusicBrainz about every name in `names`, in the order given.
    ///
    /// The `Resolution` is thrown away - the product is the memo and the `MbArtistLookup` rows, which
    /// is what makes this phase resumable for free: a crash costs only the names not yet asked. Driving
    /// the network from the *name* list rather than from the track list is also what makes progress
    /// alphabetical and the counter honest; the old track-driven loop reported
    /// `resolved_names.len() + 1`, a different population that stalled and repeated whenever a name
    /// deferred.
    pub async fn prefetch(&mut self, names: &[String], progress: Option<&Reporter>) {
        let total = names.len();
        for (i, name) in names.iter().enumerate() {
            if let Some(reporter) = progress {
                reporter.transient(&format!("[{}/{}] {}", i + 1, total, name));
            }
            self.resolve(name).await;
        }
        if let Some(reporter) = progress {
            reporter.clear_transient();
        }
    }

    /// Resolve one tag string, fetching whatever the synchronous search asks for.
    ///
    /// The search is sync and answers `NeedsFetch` for anything not memoized; each pass therefore
    /// surfaces one missing name, which is fetched before retrying. Passes are pure CPU, so the loop
    /// costs exactly one network call per distinct name - the network, not the iteration count, is the
    /// budget that matters.
    pub async fn resolve(&mut self, name: &str) -> (Resolution, ResolveSource) {
        loop {
            let mut wanted: Option<String> = None;
            let (res, src) = {
                let memo = &self.memo;
                resolve_with(name, |q| match memo.get(q) {
                    Some(r) => r.clone(),
                    None => {
                        if wanted.is_none() {
                            wanted = Some(q.to_string());
                        }
                        LookupResult::NeedsFetch
                    }
                })
            };

            match wanted {
                Some(q) => {
                    let r = self.fetch(&q).await;
                    // Genuine outage: stop, defer this name, try again next run.
                    if r == LookupResult::Transient {
                        self.stats.deferred += 1;
                        return (Resolution::Deferred, ResolveSource::Deferred);
                    }
                }
                None => {
                    self.record(src);
                    return (res, src);
                }
            }
        }
    }

    fn record(&mut self, src: ResolveSource) {
        self.stats.names_seen += 1;
        match src {
            ResolveSource::EmbeddedId => self.stats.from_embedded += 1,
            ResolveSource::Cache => self.stats.from_cache += 1,
            ResolveSource::MbWhole => self.stats.from_mb_whole += 1,
            ResolveSource::MbSpan => self.stats.from_mb_span += 1,
            ResolveSource::FallbackAtoms => self.stats.from_fallback += 1,
            ResolveSource::Deferred => self.stats.deferred += 1,
        }
    }
}

/// Tier 0: the file already carries the split. `artists[i]` pairs with `mbArtistIds[i]`, so when the
/// two line up (and there is more than one) Picard has already answered the question authoritatively -
/// no separator guessing, no API call. Mismatched lengths mean the tags disagree, so we fall through.
///
/// A **single** pair counts too, but only when that one value *is* the whole tag. That case is the
/// strongest possible proof the string is one artist, and it is what makes names like
/// "Kool & the Gang" or "Tom Petty and the Heartbreakers" safe offline - they carry a separator, so
/// without it they would depend entirely on the MB lookup succeeding.
///
/// The equality guard is not theoretical: of 3,308 single-pair tracks measured on the library, 3,307
/// match their tag exactly and one does not - tag `"The B.B. King Blues Band"` with the embedded value
/// `"B.B. King"` (Picard credited the person, not the band). Trusting that pair would silently replace
/// the band with the person, so a mismatch falls through to the normal lookup path instead.
pub fn embedded_pairing(
    tag: &str,
    artists: &[String],
    mb_ids: &[String],
    join: JoinKind,
) -> Option<Vec<ResolvedArtist>> {
    if artists.is_empty() || artists.len() != mb_ids.len() {
        return None;
    }
    if artists.len() == 1 && normalize_name(&artists[0]) != normalize_name(tag) {
        return None;
    }
    Some(
        artists
            .iter()
            .zip(mb_ids.iter())
            .enumerate()
            .map(|(i, (name, mbid))| ResolvedArtist {
                name: name.clone(),
                mbid: Some(mbid.clone()),
                verified: true,
                // The first credited artist owns; the rest follow the tag's join phrase.
                role: if i == 0 { JoinKind::CoBilling } else { join },
            })
            .collect(),
    )
}

/// Which frame a release's owner tag came from - the pairing arrays differ, so the caller has to know.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerTag<'a> {
    AlbumArtist(&'a str),
    TrackArtist(&'a str),
}

impl<'a> OwnerTag<'a> {
    pub fn value(&self) -> &'a str {
        match self {
            OwnerTag::AlbumArtist(v) | OwnerTag::TrackArtist(v) => v,
        }
    }
}

/// The tag that names a release's owner(s): `albumArtist` when present and not a Various-Artists
/// placeholder, otherwise the track's own `artist` tag - whole, never naively split here.
///
/// One definition, called from both places that need it. They used to have their own: the folder loop
/// (`main.rs`) had the VA fallback, the resolve pass's owner reconcile read `albumArtist` alone. On a VA
/// compilation the loop wrote provisional owners from the raw `artist` tag and the reconcile then had
/// nothing to replace them with, so `"Aaron Neville, Kenny G, Walter Afanasieff, ..."` stayed a
/// browsable artist owning The Bodyguard OST. 497 of those had accumulated.
pub fn owner_tag<'a>(album_artist: Option<&'a str>, artist: Option<&'a str>) -> Option<OwnerTag<'a>> {
    let usable = |t: &'a str| (!t.trim().is_empty()).then_some(t);
    album_artist
        .and_then(usable)
        .filter(|t| !is_special_artist_name(t))
        .map(OwnerTag::AlbumArtist)
        .or_else(|| artist.and_then(usable).map(OwnerTag::TrackArtist))
}

/// Decide the folder loop's provisional owner(s) for a release, from a single "owner tag" -
/// `albumArtist` when present, otherwise the track's own `artist` tag, whole and unsplit.
///
/// Used identically regardless of which tag it came from: resolve offline only (embedded pairs, the
/// lookup cache, the `KNOWN_SINGLE_ARTISTS` backstop - never a network call, never the naive
/// character splitter). A confident answer means the right artists own the release from the moment
/// it is indexed. A cold cache deliberately returns the **whole raw tag** as one provisional owner
/// rather than guessing a split - splitting with no evidence is exactly how real bands get
/// shredded (`"Simon & Garfunkel"` -> a lone `"Simon"`) - and the post-loop resolve pass
/// (`resolve_and_apply`) reconciles the provisional owner away once MusicBrainz can be asked.
///
/// A pure function (no I/O) so the offline-vs-provisional decision is unit-testable without a
/// database; `main.rs`'s folder loop supplies the lookup closure and does the actual DB writes.
pub fn resolve_owner_offline<F>(owner_tag: &str, lookup: F) -> Vec<(String, Option<String>)>
where
    F: FnMut(&str) -> LookupResult,
{
    match common::mb::resolve::resolve_offline(owner_tag, lookup) {
        Some(mut parts) => {
            // Cap here as well as in the resolve pass. A warm cache lets the folder loop resolve a
            // 44-name personnel list on the spot, and without this it wrote 44 provisional owners for
            // the pass to trim - a browse page per session musician until the pass caught up.
            cap_co_owners(&mut parts);
            parts
                .into_iter()
                .filter(|p| p.role == JoinKind::CoBilling && !is_special_artist_name(&p.name))
                .map(|p| (p.name, p.mbid))
                .collect()
        }
        None => vec![(owner_tag.to_string(), None)],
    }
}

/// Slug -> artist id for every artist that can be the target of a credit. Connected (duplicate)
/// artists are excluded so a credit always lands on the canonical primary, never the hidden twin.
pub async fn artist_slug_map(pool: &PgPool) -> HashMap<String, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT slug, id FROM "Artist" WHERE "primaryArtistId" IS NULL"#)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    rows.into_iter().collect()
}

/// Create (or reuse) the Artist row for a resolved part, and record its MBID when we learned one.
///
/// Only MB-verified names may be created here. An unverified fallback atom is a guess, and creating a
/// browsable artist from a guess is exactly the junk this refactor exists to stop - callers must
/// filter on `verified` before calling for credit-side parts.
pub async fn ensure_resolved_artist(
    pool: &PgPool,
    artist: &ResolvedArtist,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    let slug = make_slug(&artist.name);
    if slug.is_empty() {
        return Ok(String::new());
    }
    if let Some(id) = cache.get(&slug) {
        return Ok(id.clone());
    }
    let id = common::db::ensure_artist(pool, &artist.name).await?;
    if !id.is_empty() {
        if let Some(ref mbid) = artist.mbid {
            // Fill only when empty - never overwrite an id sync already established.
            sqlx::query(
                r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
                   WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
            )
            .bind(mbid)
            .bind(&id)
            .execute(pool)
            .await
            .ok();
        }
        cache.insert(slug, id.clone());
    }
    Ok(id)
}

struct TrackRow {
    id: String,
    artist: Option<String>,
    album_artist: Option<String>,
    local_release_id: Option<String>,
    artists: Vec<String>,
    mb_artist_ids: Vec<String>,
    album_artists: Vec<String>,
    mb_album_artist_ids: Vec<String>,
}

/// Resolve every artist/albumArtist tag in scope and make the DB match:
///   * album-artist owners  -> `LocalReleaseArtist`
///   * everyone else credited on a track -> `TrackRelatedArtist`
///
/// A credit is written only for an MB-verified artist; unverified fallback atoms are deliberately
/// dropped rather than turned into browsable junk. An artist already owning the track's release is
/// never also credited on it (no self-credits).
pub async fn resolve_and_apply(
    pool: &PgPool,
    resolver: &mut ArtistResolver<'_>,
    scoped_release_ids: Option<&[String]>,
    report: &mut Vec<Decision>,
    progress: Option<&Reporter>,
) -> Result<(), sqlx::Error> {
    // The four multi-value frames decode as Option: Prisma cannot express NOT NULL on a scalar list,
    // so a database built by `prisma db push` (fresh install, vitest harness) has them nullable while
    // the migration made them NOT NULL DEFAULT ARRAY[]. Decoding them as plain Vec made the whole pass
    // die with UnexpectedNullError on such a database. An absent frame means "no embedded pairing",
    // which is exactly what an empty Vec already means here.
    type Row = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<Vec<String>>,
        Option<Vec<String>>,
        Option<Vec<String>>,
        Option<Vec<String>>,
    );
    const COLS: &str = r#"id, artist, "albumArtist", "localReleaseId", artists, "mbArtistIds", "albumArtists", "mbAlbumArtistIds""#;
    let rows: Vec<Row> = match scoped_release_ids {
        Some(ids) => sqlx::query_as(&format!(
            r#"SELECT {} FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[]) ORDER BY id"#,
            COLS
        ))
        .bind(ids)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as(&format!(
            r#"SELECT {} FROM "LocalReleaseTrack" ORDER BY id"#,
            COLS
        ))
        .fetch_all(pool)
        .await?,
    };
    let tracks: Vec<TrackRow> = rows
        .into_iter()
        .map(
            |(
                id,
                artist,
                album_artist,
                local_release_id,
                artists,
                mb_artist_ids,
                album_artists,
                mb_album_artist_ids,
            )| TrackRow {
                id,
                artist,
                album_artist,
                local_release_id,
                artists: artists.unwrap_or_default(),
                mb_artist_ids: mb_artist_ids.unwrap_or_default(),
                album_artists: album_artists.unwrap_or_default(),
                mb_album_artist_ids: mb_album_artist_ids.unwrap_or_default(),
            },
        )
        .collect();

    // release -> current owners, so a credit never duplicates an owner. Scoped with the tracks: a
    // one-artist run has no use for the other ~165k ownership links.
    let owner_rows: Vec<(String, String)> = match scoped_release_ids {
        Some(ids) => sqlx::query_as(
            r#"SELECT "localReleaseId", "artistId" FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = ANY($1::text[])"#,
        )
        .bind(ids)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as(r#"SELECT "localReleaseId", "artistId" FROM "LocalReleaseArtist""#)
            .fetch_all(pool)
            .await?,
    };
    let mut owners_by_release: HashMap<String, HashSet<String>> = HashMap::new();
    for (release_id, artist_id) in owner_rows {
        owners_by_release
            .entry(release_id)
            .or_default()
            .insert(artist_id);
    }

    let mut slug_cache = artist_slug_map(pool).await;
    let mut resolved_names: HashMap<String, Vec<ResolvedArtist>> = HashMap::new();
    // Kept apart from `resolved_names`: the same string can be a track's `artist` tag AND (on a VA
    // compilation) its owner tag, and the two want different join semantics - co-billing for owners,
    // guest for credits. One map would hand the credit pass a capped, co-billed answer.
    let mut resolved_owners: HashMap<String, Vec<ResolvedArtist>> = HashMap::new();
    let mut desired_credits: HashSet<(String, String)> = HashSet::new();
    let mut new_owner_links: HashSet<(String, String)> = HashSet::new();
    // Releases whose album artist could not be decided this run (MusicBrainz unreachable). Their
    // ownership is left exactly as-is - stripping owners on an incomplete picture is how a release
    // ends up invisible, unsyncable, and deletable by ./delete's sweep.
    let mut releases_with_deferred: HashSet<String> = HashSet::new();

    // Phase B is offline - every name Phase A asked about is already memoized - so progress here is
    // measured in tracks, not names. Reported every PROGRESS_EVERY tracks: 1.8M transient lines is
    // noise, and the terminal spends longer redrawing them than the loop spends working.
    const PROGRESS_EVERY: usize = 500;
    let total_tracks = tracks.len();

    for (i, track) in tracks.iter().enumerate() {
        if let Some(reporter) = progress {
            if i % PROGRESS_EVERY == 0 {
                reporter.transient(&format!("Applying links [{}/{}]", i + 1, total_tracks));
            }
        }

        // --- the owner tag decides who OWNS the release ------------------------------------------
        //
        // `owner_tag` - not `albumArtist` - because the folder loop uses the same rule and the two must
        // not drift. They did: this branch read `albumArtist` alone, so on a Various-Artists compilation
        // it resolved "Various Artists" to nothing, the release never entered `new_owner_links`, and the
        // reconcile below skipped it under the empty-desired-set guard. The provisional owners the
        // folder loop had written from the raw per-track `artist` tag were therefore permanent - 497
        // unverified compounds like `Aaron Neville, Kenny G, Walter Afanasieff, ...` owning The
        // Bodyguard OST.
        if let (Some(tag), Some(release_id)) = (
            owner_tag(track.album_artist.as_deref(), track.artist.as_deref()),
            track.local_release_id.as_ref(),
        ) {
            let owner = tag.value();
            // Tier 0 applies here too, paired against whichever frame the owner tag came from.
            let (multi, mb_ids) = match tag {
                OwnerTag::AlbumArtist(_) => (&track.album_artists, &track.mb_album_artist_ids),
                OwnerTag::TrackArtist(_) => (&track.artists, &track.mb_artist_ids),
            };

            if !resolved_owners.contains_key(owner) {
                match embedded_pairing(owner, multi, mb_ids, JoinKind::CoBilling) {
                    Some(mut parts) => {
                        resolver.stats.from_embedded += 1;
                        cap_co_owners(&mut parts);
                        report.push(Decision {
                            name: owner.to_string(),
                            source: ResolveSource::EmbeddedId,
                            parts: parts.clone(),
                        });
                        resolved_owners.insert(owner.to_string(), parts);
                    }
                    None => {
                        let (res, src) = resolver.resolve(owner).await;
                        match res {
                            Resolution::Resolved(mut parts) => {
                                // An album artist naming dozens of people is a personnel list, not
                                // co-billing.
                                cap_co_owners(&mut parts);
                                report.push(Decision {
                                    name: owner.to_string(),
                                    source: src,
                                    parts: parts.clone(),
                                });
                                resolved_owners.insert(owner.to_string(), parts);
                            }
                            Resolution::Deferred => {
                                releases_with_deferred.insert(release_id.clone());
                            }
                        }
                    }
                }
            }
            if !resolved_owners.contains_key(owner) {
                // Deferred on an earlier track of this same release.
                releases_with_deferred.insert(release_id.clone());
            }
            if let Some(parts) = resolved_owners.get(owner).cloned() {
                for part in parts {
                    // Guest-joined album artists are credits, not owners - "Frank Sinatra with Count
                    // Basie" means Sinatra's album, Basie appearing on it.
                    let is_owner = part.role == JoinKind::CoBilling;
                    if !is_owner && !part.verified {
                        continue;
                    }
                    // A tier-0 pairing can hand back the placeholder itself (`{"Various Artists",
                    // "Whitney Houston"}`); it is never an owner.
                    if is_special_artist_name(&part.name) {
                        continue;
                    }
                    let id = if resolver.dry_run {
                        slug_cache
                            .get(&make_slug(&part.name))
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        ensure_resolved_artist(pool, &part, &mut slug_cache).await?
                    };
                    if id.is_empty() {
                        continue;
                    }
                    if is_owner {
                        new_owner_links.insert((release_id.clone(), id));
                    } else {
                        desired_credits.insert((track.id.clone(), id));
                    }
                }
            }
        }

        // --- artist tag produces track CREDITS ---------------------------------------------------
        // Tier 0 first: the file's own paired artists/MBIDs need no lookup at all.
        let embedded = embedded_pairing(
            track.artist.as_deref().unwrap_or(""),
            &track.artists,
            &track.mb_artist_ids,
            JoinKind::Guest,
        );
        let parts: Vec<ResolvedArtist> = match embedded {
            Some(p) => {
                resolver.stats.from_embedded += 1;
                p
            }
            None => {
                let Some(tag) = track.artist.as_ref().filter(|t| !t.trim().is_empty()) else {
                    continue;
                };
                if !resolved_names.contains_key(tag) {
                    let (res, src) = resolver.resolve(tag).await;
                    match res {
                        Resolution::Resolved(parts) => {
                            report.push(Decision {
                                name: tag.clone(),
                                source: src,
                                parts: parts.clone(),
                            });
                            resolved_names.insert(tag.clone(), parts);
                        }
                        // Deferred: leave this track untouched, retry next run.
                        Resolution::Deferred => continue,
                    }
                }
                resolved_names.get(tag).cloned().unwrap_or_default()
            }
        };

        for part in parts {
            if !part.verified {
                continue; // never create a browsable artist from a guess
            }
            let id = if resolver.dry_run {
                slug_cache
                    .get(&make_slug(&part.name))
                    .cloned()
                    .unwrap_or_default()
            } else {
                ensure_resolved_artist(pool, &part, &mut slug_cache).await?
            };
            if id.is_empty() {
                continue;
            }
            let owns = track
                .local_release_id
                .as_ref()
                .and_then(|r| owners_by_release.get(r))
                .map(|set| set.contains(&id))
                .unwrap_or(false);
            let will_own = track
                .local_release_id
                .as_ref()
                .map(|r| new_owner_links.contains(&(r.clone(), id.clone())))
                .unwrap_or(false);
            if !owns && !will_own {
                desired_credits.insert((track.id.clone(), id));
            }
        }
    }

    if resolver.dry_run {
        return Ok(());
    }

    // --- reconcile owners ------------------------------------------------------------------------
    //
    // Ownership is not append-only: the folder scan may have written the raw albumArtist tag as a
    // provisional owner (cold cache), and that compound must be replaced by the artists it actually
    // names. Insert first, delete second, inside one transaction, so a release is never momentarily
    // ownerless - an ownerless release is invisible in /browse, unsyncable, and used to be deletable by
    // ./delete's sweep.
    //
    // The desired set for a release is the UNION of resolved owners across all of its tracks' album
    // artists: 11 of 435 releases measured carry more than one distinct albumArtist (per-source
    // compilations), and overwriting from a single track would silently strip the co-owners.
    let mut desired_owners: HashMap<String, HashSet<String>> = HashMap::new();
    for (release_id, artist_id) in &new_owner_links {
        desired_owners
            .entry(release_id.clone())
            .or_default()
            .insert(artist_id.clone());
    }

    let mut tx = pool.begin().await?;

    if !new_owner_links.is_empty() {
        let (rel, art): (Vec<String>, Vec<String>) = new_owner_links.iter().cloned().unzip();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
               SELECT gen_random_uuid()::text, r, a, NOW()
               FROM UNNEST($1::text[], $2::text[]) AS t(r, a)
               ON CONFLICT ("localReleaseId", "artistId") DO NOTHING"#,
        )
        .bind(&rel)
        .bind(&art)
        .execute(&mut *tx)
        .await?;
    }

    for (release_id, desired) in &desired_owners {
        // MusicBrainz could not decide one of this release's album artists - leave ownership alone and
        // let a later run converge.
        if releases_with_deferred.contains(release_id) {
            continue;
        }
        // Nothing resolved (e.g. "Various Artists", or every part unverified): never strip the owner
        // the folder scan established.
        if desired.is_empty() {
            continue;
        }
        let keep: Vec<String> = desired.iter().cloned().collect();
        sqlx::query(
            r#"DELETE FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = $1 AND "artistId" <> ALL($2::text[])"#,
        )
        .bind(release_id)
        .bind(&keep)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    // --- reconcile credits for the tracks in scope ----------------------------------------------
    let track_ids: Vec<String> = tracks.iter().map(|t| t.id.clone()).collect();
    let existing_rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "trackId", "artistId" FROM "TrackRelatedArtist" WHERE "trackId" = ANY($1::text[])"#,
    )
    .bind(&track_ids)
    .fetch_all(pool)
    .await?;
    let existing: HashSet<(String, String)> = existing_rows.into_iter().collect();

    let to_remove: Vec<(String, String)> = existing.difference(&desired_credits).cloned().collect();
    if !to_remove.is_empty() {
        let (t, a): (Vec<String>, Vec<String>) = to_remove.into_iter().unzip();
        sqlx::query(
            r#"DELETE FROM "TrackRelatedArtist" x
               USING UNNEST($1::text[], $2::text[]) AS d(track_id, artist_id)
               WHERE x."trackId" = d.track_id AND x."artistId" = d.artist_id"#,
        )
        .bind(&t)
        .bind(&a)
        .execute(pool)
        .await?;
    }

    let to_add: Vec<(String, String)> = desired_credits.difference(&existing).cloned().collect();
    if !to_add.is_empty() {
        crate::db::batch_ensure_track_related_artists(pool, &to_add)
            .await
            .ok();
    }

    if let Some(reporter) = progress {
        reporter.clear_transient();
    }

    Ok(())
}

/// Has every lookup this name needs already been answered?
///
/// The "pin" that lets a rerun skip work it already paid for. Deliberately stronger than "a cache row
/// exists for this string": a compound like `"A feat. B"` caches its whole-string miss under its own
/// key but still needs a row per span, so row-presence alone would skip a name with most of its work
/// left. Running the real search against the memo and watching for a single `NeedsFetch` is the only
/// honest test - pure CPU, no network, nothing mutated.
pub fn is_fully_memoized(memo: &HashMap<String, LookupResult>, name: &str) -> bool {
    let mut needs_fetch = false;
    resolve_with(name, |q| match memo.get(q) {
        Some(r) => r.clone(),
        None => {
            needs_fetch = true;
            LookupResult::NeedsFetch
        }
    });
    !needs_fetch
}

/// Distinct non-empty tag values to resolve, sorted case-insensitively.
///
/// The order is the user-facing one: it is what Phase A walks, so progress reads alphabetically and a
/// resumed run picks up somewhere recognisable. Without the `ORDER BY` this returned Postgres's
/// hash-distinct order - arbitrary, and free to differ between runs.
pub async fn distinct_tag_values(
    pool: &PgPool,
    scoped_release_ids: Option<&[String]>,
) -> Vec<String> {
    let rows: Vec<(String,)> = match scoped_release_ids {
        Some(ids) => sqlx::query_as(
            r#"SELECT v FROM (
                   SELECT artist AS v FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])
                   UNION
                   SELECT "albumArtist" AS v FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])
               ) s WHERE v IS NOT NULL AND v <> ''
               ORDER BY lower(v), v"#,
        )
        .bind(ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
        None => sqlx::query_as(
            r#"SELECT v FROM (
                   SELECT artist AS v FROM "LocalReleaseTrack"
                   UNION
                   SELECT "albumArtist" AS v FROM "LocalReleaseTrack"
               ) s WHERE v IS NOT NULL AND v <> ''
               ORDER BY lower(v), v"#,
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
    };
    // No second dedupe pass: `UNION` (not `UNION ALL`) already guarantees uniqueness, and the old
    // HashSet filter existed only to preserve an order the SQL never established. The explicit
    // `SELECT DISTINCT` went with it - Postgres rejects `ORDER BY lower(v)` alongside it, since a
    // DISTINCT's sort keys must appear in the select list.
    rows.into_iter().map(|(v,)| v).collect()
}

#[cfg(test)]
mod tests {
    use super::{is_fully_memoized, resolve_owner_offline};
    use common::mb::resolve::LookupResult;
    use std::collections::HashMap;

    /// A lookup that never has an answer - the folder loop's actual condition on a cold cache.
    fn cold(_: &str) -> LookupResult {
        LookupResult::NeedsFetch
    }

    fn memo(entries: &[(&str, LookupResult)]) -> HashMap<String, LookupResult> {
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn a_cold_memo_pins_nothing() {
        assert!(!is_fully_memoized(&HashMap::new(), "Miles Davis"));
    }

    #[test]
    fn a_whole_string_answer_is_enough_for_a_simple_name() {
        // Hit or miss, both are answers: a name with no separators needs exactly one lookup, so once
        // that lookup is cached there is nothing left to ask.
        let found = memo(&[("Miles Davis", LookupResult::Found { mbid: None })]);
        assert!(is_fully_memoized(&found, "Miles Davis"));
        let missing = memo(&[("Some Unknown Act", LookupResult::NotFound)]);
        assert!(is_fully_memoized(&missing, "Some Unknown Act"));
    }

    #[test]
    fn a_compound_needs_its_spans_not_just_its_whole_string() {
        // The reason the pin runs the real search instead of checking for a cache row. The whole-string
        // miss IS cached here, so a row-presence check would call this name done and skip the span
        // lookups that are the actual work.
        let whole_only = memo(&[("Sonny Rollins feat. Jim Hall", LookupResult::NotFound)]);
        assert!(!is_fully_memoized(&whole_only, "Sonny Rollins feat. Jim Hall"));

        let complete = memo(&[
            ("Sonny Rollins feat. Jim Hall", LookupResult::NotFound),
            ("Sonny Rollins", LookupResult::Found { mbid: None }),
            ("Jim Hall", LookupResult::Found { mbid: None }),
        ]);
        assert!(is_fully_memoized(&complete, "Sonny Rollins feat. Jim Hall"));
    }

    #[test]
    fn a_backstopped_duo_stays_whole_even_on_a_cold_cache() {
        // This is the exact regression the migration off `split_artists` fixes: the old code split
        // the track-artist tag unconditionally and took the first fragment, so a folder with no
        // albumArtist and track artist "Simon & Garfunkel" would have been owned by a lone "Simon".
        let owners = resolve_owner_offline("Simon & Garfunkel", cold);
        assert_eq!(
            owners,
            vec![("Simon & Garfunkel".to_string(), None)],
            "a known duo must stay one owner, never a split fragment"
        );
    }

    #[test]
    fn an_unresolvable_cold_cache_tag_is_kept_whole_as_a_provisional_owner() {
        // Not backstopped, not in cache, no network available offline: must NOT guess a split.
        // The whole raw tag becomes the provisional owner, corrected later by resolve_and_apply
        // once MusicBrainz can actually be asked - never a fragment of it.
        let owners = resolve_owner_offline("Obscure Duo & Friends", cold);
        assert_eq!(owners, vec![("Obscure Duo & Friends".to_string(), None)]);
    }

    #[test]
    fn a_genuine_split_still_happens_when_the_cache_confirms_both_atoms() {
        // Proves the migration didn't lose real splitting power - it only removed the *blind*
        // splitting. A warm cache that actually confirms two distinct real artists still produces
        // two owners.
        let lookup = |name: &str| match name {
            "Artist One & Artist Two" => LookupResult::NotFound,
            "Artist One" => LookupResult::Found { mbid: Some("mbid-one".into()) },
            "Artist Two" => LookupResult::Found { mbid: Some("mbid-two".into()) },
            _ => LookupResult::NeedsFetch,
        };
        let mut owners = resolve_owner_offline("Artist One & Artist Two", lookup);
        owners.sort();
        assert_eq!(
            owners,
            vec![
                ("Artist One".to_string(), Some("mbid-one".to_string())),
                ("Artist Two".to_string(), Some("mbid-two".to_string())),
            ]
        );
    }

    #[test]
    fn guest_joined_parts_are_excluded_only_the_owner_remains() {
        // "A with B" means A owns the release, B is merely credited - resolve_owner_offline must
        // only ever return owners, so a guest-joined name must not smuggle the guest in as a
        // second owner.
        let lookup = |name: &str| match name {
            "Frank Sinatra with Count Basie" => LookupResult::NotFound,
            "Frank Sinatra" => LookupResult::Found { mbid: Some("sinatra-id".into()) },
            "Count Basie" => LookupResult::Found { mbid: Some("basie-id".into()) },
            _ => LookupResult::NeedsFetch,
        };
        let owners = resolve_owner_offline("Frank Sinatra with Count Basie", lookup);
        assert_eq!(
            owners,
            vec![("Frank Sinatra".to_string(), Some("sinatra-id".to_string()))],
            "the guest must not appear in the owners list"
        );
    }
}
