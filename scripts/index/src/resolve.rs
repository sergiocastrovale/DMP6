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

use common::mb::api::{mb_search_artist_exact, RateLimiter};
use common::mb::names::normalize_name;
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
            client: Client::new(),
            limiter: RateLimiter::new(),
            memo: HashMap::new(),
            dry_run,
            offline: false,
            stats: ResolveStats::default(),
        }
    }

    /// Seed the memo from the cache table in one query rather than a round-trip per name.
    pub async fn warm_cache(&mut self, names: &[String]) {
        if names.is_empty() {
            return;
        }
        let rows: Vec<(String, Option<String>, bool)> = sqlx::query_as(
            r#"SELECT name, mbid, ("mbid" IS NULL AND "checkedAt" < NOW() - ($2 || ' days')::interval) AS stale
               FROM "MbArtistLookup" WHERE name = ANY($1::text[])"#,
        )
        .bind(names)
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
    async fn persist_lookup(&self, name: &str, result: &LookupResult) {
        let (mbid, mb_name) = match result {
            LookupResult::Found { mbid } => (mbid.clone(), None::<String>),
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
        let result = match mb_search_artist_exact(&self.client, name, &mut self.limiter).await {
            Ok(Some(m)) => LookupResult::Found { mbid: Some(m.id) },
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
        self.persist_lookup(name, &result).await;
        self.memo.insert(name.to_string(), result.clone());
        result
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
) -> Result<(), sqlx::Error> {
    type Row = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Vec<String>,
        Vec<String>,
        Vec<String>,
        Vec<String>,
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
                artists,
                mb_artist_ids,
                album_artists,
                mb_album_artist_ids,
            },
        )
        .collect();

    // release -> current owners, so a credit never duplicates an owner.
    let owner_rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "localReleaseId", "artistId" FROM "LocalReleaseArtist""#)
            .fetch_all(pool)
            .await?;
    let mut owners_by_release: HashMap<String, HashSet<String>> = HashMap::new();
    for (release_id, artist_id) in owner_rows {
        owners_by_release
            .entry(release_id)
            .or_default()
            .insert(artist_id);
    }

    let mut slug_cache = artist_slug_map(pool).await;
    let mut resolved_names: HashMap<String, Vec<ResolvedArtist>> = HashMap::new();
    let mut desired_credits: HashSet<(String, String)> = HashSet::new();
    let mut new_owner_links: HashSet<(String, String)> = HashSet::new();
    // Releases whose album artist could not be decided this run (MusicBrainz unreachable). Their
    // ownership is left exactly as-is - stripping owners on an incomplete picture is how a release
    // ends up invisible, unsyncable, and deletable by ./delete's sweep.
    let mut releases_with_deferred: HashSet<String> = HashSet::new();

    for track in &tracks {
        // --- album artist decides who OWNS the release -----------------------------------------
        if let (Some(aa), Some(release_id)) =
            (track.album_artist.as_ref(), track.local_release_id.as_ref())
        {
            if !aa.trim().is_empty() && !resolved_names.contains_key(aa) {
                // Tier 0 applies here too: the album-artist frames pair the same way.
                let embedded_aa = embedded_pairing(
                    aa,
                    &track.album_artists,
                    &track.mb_album_artist_ids,
                    JoinKind::CoBilling,
                );
                match embedded_aa {
                    Some(mut parts) => {
                        resolver.stats.from_embedded += 1;
                        cap_co_owners(&mut parts);
                        report.push(Decision {
                            name: aa.clone(),
                            source: ResolveSource::EmbeddedId,
                            parts: parts.clone(),
                        });
                        resolved_names.insert(aa.clone(), parts);
                    }
                    None => {
                        let (res, src) = resolver.resolve(aa).await;
                        match res {
                            Resolution::Resolved(mut parts) => {
                                // An album artist naming dozens of people is a personnel list, not
                                // co-billing.
                                cap_co_owners(&mut parts);
                                report.push(Decision {
                                    name: aa.clone(),
                                    source: src,
                                    parts: parts.clone(),
                                });
                                resolved_names.insert(aa.clone(), parts);
                            }
                            Resolution::Deferred => {
                                releases_with_deferred.insert(release_id.clone());
                            }
                        }
                    }
                }
            }
            if !aa.trim().is_empty() && !resolved_names.contains_key(aa) {
                // Deferred on an earlier track of this same release.
                releases_with_deferred.insert(release_id.clone());
            }
            if let Some(parts) = resolved_names.get(aa).cloned() {
                for part in parts {
                    // Guest-joined album artists are credits, not owners - "Frank Sinatra with Count
                    // Basie" means Sinatra's album, Basie appearing on it.
                    let is_owner = part.role == JoinKind::CoBilling;
                    if !is_owner && !part.verified {
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

    Ok(())
}

/// Distinct non-empty tag values to resolve, newest-first so a targeted run does useful work early.
pub async fn distinct_tag_values(
    pool: &PgPool,
    scoped_release_ids: Option<&[String]>,
) -> Vec<String> {
    let rows: Vec<(String,)> = match scoped_release_ids {
        Some(ids) => sqlx::query_as(
            r#"SELECT DISTINCT v FROM (
                   SELECT artist AS v FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])
                   UNION
                   SELECT "albumArtist" AS v FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])
               ) s WHERE v IS NOT NULL AND v <> ''"#,
        )
        .bind(ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
        None => sqlx::query_as(
            r#"SELECT DISTINCT v FROM (
                   SELECT artist AS v FROM "LocalReleaseTrack"
                   UNION
                   SELECT "albumArtist" AS v FROM "LocalReleaseTrack"
               ) s WHERE v IS NOT NULL AND v <> ''"#,
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
    };
    let mut seen: HashSet<String> = HashSet::new();
    rows.into_iter()
        .map(|(v,)| v)
        .filter(|v| seen.insert(v.clone()))
        .collect()
}
