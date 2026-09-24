use chrono::{NaiveDateTime, Utc};
use common::filters::sanitize_mb_id;
use common::mb::api::audio_media;
use common::mb::types::{MbMedia, MbRecordingRef, MbRelease, MbTrack};
use slug::slugify;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// ReleaseType
// ---------------------------------------------------------------------------

pub async fn ensure_release_type(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let slug = slugify(name);
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (name) DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&slug)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn ensure_release_type_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(name) {
        return Ok(id.clone());
    }
    let id = ensure_release_type(pool, name).await?;
    cache.insert(name.to_string(), id.clone());
    Ok(id)
}

// ---------------------------------------------------------------------------
// Genre
// ---------------------------------------------------------------------------

pub async fn ensure_genre(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "Genre" (id, name)
           VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn ensure_genre_cached(
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

// ---------------------------------------------------------------------------
// MusicBrainzRelease upsert
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
pub struct MbReleaseExtras<'a> {
    pub edition_label: Option<&'a str>,
    pub release_date: Option<&'a str>,
    pub packaging: Option<&'a str>,
    pub country: Option<&'a str>,
    pub format: Option<&'a str>,
    // The owning release-group's secondary types (Compilation, Live, Remix, Soundtrack, ...) -
    // already fetched for allowlist::is_allowed, just not previously persisted. [] = "original
    // work", the signal the box-set equivalence tier-3 matcher uses (docs/sync_decisions.md).
    pub release_group_secondary_types: &'a [String],
}

/// Same shape as `upsert_mb_release_with_media` below, minus `mediumCount` - the two already-grouped
/// pieces here (the release's own identity fields, plus `MbReleaseExtras`) don't have a further natural
/// grouping without going fully artificial.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_mb_release(
    pool: &PgPool,
    mb_release_id: &str,
    release_group_id: &str,
    title: &str,
    year: Option<i32>,
    type_id: &str,
    status: &str,
    status_reason: Option<&str>,
    disambiguation: Option<&str>,
    extras: &MbReleaseExtras<'_>,
) -> Result<String, sqlx::Error> {
    upsert_mb_release_with_media(
        pool,
        mb_release_id,
        release_group_id,
        title,
        year,
        type_id,
        status,
        status_reason,
        disambiguation,
        extras,
        1,
    )
    .await
}

/// `MusicBrainzRelease.title` is `VarChar(500)`, and Postgres rejects an over-long value outright
/// rather than truncating it. MusicBrainz has a handful of genuinely enormous titles - Soulwax's
/// "Most of the remixes we've made for other people over the years except for the one for Einstürzende
/// Neubauten…" runs past 600 characters - and every one of them failed the insert with `value too long
/// for type character varying(500)`, taking the whole release with it.
///
/// Clamped by **characters**, not bytes: the column counts characters, and byte slicing would also
/// risk splitting a multi-byte character and panicking.
fn clamp_title(title: &str) -> String {
    const MAX: usize = 500;
    if title.chars().count() <= MAX {
        return title.to_string();
    }
    title.chars().take(MAX).collect()
}

/// Same as `upsert_mb_release`, plus `mediumCount` - the distinct MB media on the release (1 for a
/// plain album, 9 for a box set). Denormalized onto the release row so the artist releases endpoint
/// (a hot list route) never has to join `MusicBrainzReleaseMedium` just to render a disc-count
/// marker. Kept as a separate function rather than adding a parameter to `upsert_mb_release` so the
/// many call sites that don't yet compute a medium count (single-medium releases) aren't disturbed.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_mb_release_with_media(
    pool: &PgPool,
    mb_release_id: &str,
    release_group_id: &str,
    title: &str,
    year: Option<i32>,
    type_id: &str,
    status: &str,
    status_reason: Option<&str>,
    disambiguation: Option<&str>,
    extras: &MbReleaseExtras<'_>,
    medium_count: i32,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let title = clamp_title(title);
    let title = title.as_str();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "MusicBrainzRelease"
             (id, title, "typeId", year, "musicbrainzId", "releaseGroupId",
              disambiguation, "editionLabel", "releaseDate", packaging, country, format,
              status, "statusReason", "mediumCount", "releaseGroupSecondaryTypes", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::"ReleaseStatus", $14, $15, $16, $17, $17)
           ON CONFLICT ("musicbrainzId") DO UPDATE SET
             title = EXCLUDED.title,
             "typeId" = EXCLUDED."typeId",
             year = COALESCE(EXCLUDED.year, "MusicBrainzRelease".year),
             "releaseGroupId" = EXCLUDED."releaseGroupId",
             disambiguation = EXCLUDED.disambiguation,
             "editionLabel" = EXCLUDED."editionLabel",
             "releaseDate" = EXCLUDED."releaseDate",
             packaging = EXCLUDED.packaging,
             country = EXCLUDED.country,
             format = EXCLUDED.format,
             status = EXCLUDED.status::"ReleaseStatus",
             "statusReason" = EXCLUDED."statusReason",
             "mediumCount" = EXCLUDED."mediumCount",
             "releaseGroupSecondaryTypes" = CASE WHEN array_length(EXCLUDED."releaseGroupSecondaryTypes", 1) > 0
               THEN EXCLUDED."releaseGroupSecondaryTypes" ELSE "MusicBrainzRelease"."releaseGroupSecondaryTypes" END,
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(type_id)
    .bind(year)
    .bind(mb_release_id)
    .bind(release_group_id)
    .bind(disambiguation)
    .bind(extras.edition_label)
    .bind(extras.release_date)
    .bind(extras.packaging)
    .bind(extras.country)
    .bind(extras.format)
    .bind(status)
    .bind(status_reason)
    .bind(medium_count)
    .bind(extras.release_group_secondary_types)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

// ---------------------------------------------------------------------------
// MusicBrainzReleaseArtist link
// ---------------------------------------------------------------------------

pub async fn ensure_mb_release_artist_link(
    pool: &PgPool,
    release_id: &str,
    artist_id: &str,
) -> Result<(), sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("releaseId", "artistId") DO NOTHING"#,
    )
    .bind(&id)
    .bind(release_id)
    .bind(artist_id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// MusicBrainzReleaseTrack batch insert
// ---------------------------------------------------------------------------

/// Retire stale catalogue-gap placeholders: a MISSING release whose `musicbrainzId` == its
/// `releaseGroupId` is a release-group stub created by `--catalogue-gaps`. Once that group is owned
/// (some sibling release is no longer MISSING), the stub is garbage and shows up as a phantom "MISSING
/// edition" next to the real one. Delete those — but never one a LocalRelease actually points at.
/// Returns the number removed. Cheap, indexed; safe to run at the end of every sync.
///
/// The `DownloadedRelease` guard mirrors `delete_missing_releases_for_artist` below: only a *live*
/// download (still able to consume the target) pins the placeholder. A dead row (INVALID/REJECTED/
/// FAILED/ABANDONED/UNAVAILABLE) must not pin it forever — that turned a discarded MOON download into
/// a permanent phantom next to the orphaned edition `delete_orphaned_mb_releases` leaves behind, until
/// this run's caller sweeps orphans first (see the ordering comment at both call sites in main.rs).
pub async fn retire_owned_missing_placeholders(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM "MusicBrainzRelease" m
        WHERE m.status = 'MISSING'
          AND m."musicbrainzId" = m."releaseGroupId"
          AND EXISTS (
            SELECT 1 FROM "MusicBrainzRelease" o
            WHERE o."releaseGroupId" = m."releaseGroupId" AND o.id <> m.id AND o.status <> 'MISSING'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id
          )
          AND m.id NOT IN (
            SELECT "mbReleaseId" FROM "DownloadedRelease"
            WHERE "mbReleaseId" IS NOT NULL
              AND status IN ('DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED')
          )
        "#,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub struct MbTrackRow {
    pub title: String,
    pub position: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_ms: Option<i32>,
    pub mb_id: Option<String>,
    /// MB recording id - see MusicBrainzReleaseTrack.recordingId in schema.prisma. `None` for a
    /// release synced before this field existed; backfilled on the next natural re-sync.
    pub recording_id: Option<String>,
}

/// Identity of an MB track *within its release*: the MB recording id when tagged, else its slot.
/// Used to line up the incoming tracklist with the rows already stored.
fn mb_track_key(
    mb_id: Option<&str>,
    disc: Option<i32>,
    position: Option<i32>,
    title: &str,
) -> String {
    match mb_id {
        Some(id) if !id.is_empty() => format!("mb:{}", id),
        _ => format!(
            "slot:{}:{}:{}",
            disc.unwrap_or(1),
            position.unwrap_or(0),
            title.to_lowercase()
        ),
    }
}

/// Reconcile a release's stored MB tracks with the tracklist MusicBrainz just returned, **keeping
/// the ids of tracks that already exist**. Returns `(db_track_id, mb_track_id)` in input order.
///
/// The old path deleted every row and re-inserted, which changes `MusicBrainzReleaseTrack.id` on
/// every run. `LocalReleaseTrack.mbTrack` is an optional relation with no `onDelete`, so Prisma
/// defaults to SetNull: those deletes silently unlinked every local track pointing at the release.
/// With two LocalReleases bound to one MB release (multi-disc halves, or duplicate copies) the two
/// fought - whichever synced last kept its links and the other dropped to zero - and the churn also
/// invalidated `get_covered_release_group_ids`'s all-tracks-linked branch and any owned-bundle claim.
pub async fn sync_mb_tracks_for_release(
    pool: &PgPool,
    release_id: &str,
    tracks: &[MbTrackRow],
) -> Result<Vec<(String, Option<String>)>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct ExistingTrackRow {
        id: String,
        #[sqlx(rename = "musicbrainzId")]
        mb_id: Option<String>,
        #[sqlx(rename = "discNumber")]
        disc_number: Option<i32>,
        position: Option<i32>,
        title: String,
    }

    let existing: Vec<ExistingTrackRow> = sqlx::query_as(
        r#"SELECT id, "musicbrainzId", "discNumber", position, title
           FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(release_id)
    .fetch_all(pool)
    .await?;

    let mut by_key: HashMap<String, String> = HashMap::new();
    for row in &existing {
        by_key
            .entry(mb_track_key(
                row.mb_id.as_deref(),
                row.disc_number,
                row.position,
                &row.title,
            ))
            .or_insert_with(|| row.id.clone());
    }

    let now = Utc::now().naive_utc();
    let mut out: Vec<(String, Option<String>)> = Vec::with_capacity(tracks.len());
    let mut keep: HashSet<String> = HashSet::new();
    let mut to_insert: Vec<(String, &MbTrackRow)> = Vec::new();
    let mut to_update: Vec<(String, &MbTrackRow)> = Vec::new();

    for t in tracks {
        let key = mb_track_key(t.mb_id.as_deref(), t.disc_number, t.position, &t.title);
        match by_key.get(&key) {
            Some(id) if keep.insert(id.clone()) => {
                to_update.push((id.clone(), t));
                out.push((id.clone(), t.mb_id.clone()));
            }
            // A repeat of a key already claimed this run (duplicate rows from an earlier import):
            // treat it as new rather than pointing two tracklist entries at one row.
            _ => {
                let id = cuid2::create_id();
                keep.insert(id.clone());
                to_insert.push((id.clone(), t));
                out.push((id, t.mb_id.clone()));
            }
        }
    }

    if !to_update.is_empty() {
        let ids: Vec<&str> = to_update.iter().map(|(id, _)| id.as_str()).collect();
        let titles: Vec<&str> = to_update.iter().map(|(_, t)| t.title.as_str()).collect();
        let positions: Vec<Option<i32>> = to_update.iter().map(|(_, t)| t.position).collect();
        let discs: Vec<Option<i32>> = to_update.iter().map(|(_, t)| t.disc_number).collect();
        let durations: Vec<Option<i32>> = to_update.iter().map(|(_, t)| t.duration_ms).collect();
        let mb_ids: Vec<Option<&str>> = to_update.iter().map(|(_, t)| t.mb_id.as_deref()).collect();
        let recording_ids: Vec<Option<&str>> = to_update
            .iter()
            .map(|(_, t)| t.recording_id.as_deref())
            .collect();
        let timestamps: Vec<NaiveDateTime> = vec![now; to_update.len()];
        sqlx::query(
            r#"UPDATE "MusicBrainzReleaseTrack" AS t
               SET title = u.title, position = u.position, "discNumber" = u."discNumber",
                   "durationMs" = u."durationMs",
                   "musicbrainzId" = COALESCE(u."musicbrainzId", t."musicbrainzId"),
                   "recordingId" = COALESCE(u."recordingId", t."recordingId"),
                   "updatedAt" = u."updatedAt"
               FROM UNNEST(
                 $1::text[], $2::text[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[],
                 $8::timestamp[]
               ) AS u(id, title, position, "discNumber", "durationMs", "musicbrainzId",
                      "recordingId", "updatedAt")
               WHERE t.id = u.id"#,
        )
        .bind(&ids)
        .bind(&titles)
        .bind(&positions)
        .bind(&discs)
        .bind(&durations)
        .bind(&mb_ids)
        .bind(&recording_ids)
        .bind(&timestamps)
        .execute(pool)
        .await?;
    }

    if !to_insert.is_empty() {
        let ids: Vec<&str> = to_insert.iter().map(|(id, _)| id.as_str()).collect();
        let titles: Vec<&str> = to_insert.iter().map(|(_, t)| t.title.as_str()).collect();
        let positions: Vec<Option<i32>> = to_insert.iter().map(|(_, t)| t.position).collect();
        let discs: Vec<Option<i32>> = to_insert.iter().map(|(_, t)| t.disc_number).collect();
        let durations: Vec<Option<i32>> = to_insert.iter().map(|(_, t)| t.duration_ms).collect();
        let mb_ids: Vec<Option<&str>> = to_insert.iter().map(|(_, t)| t.mb_id.as_deref()).collect();
        let recording_ids: Vec<Option<&str>> = to_insert
            .iter()
            .map(|(_, t)| t.recording_id.as_deref())
            .collect();
        let release_ids: Vec<&str> = vec![release_id; to_insert.len()];
        let timestamps: Vec<NaiveDateTime> = vec![now; to_insert.len()];
        sqlx::query(
            r#"INSERT INTO "MusicBrainzReleaseTrack"
                 (id, title, position, "discNumber", "durationMs", "musicbrainzId", "recordingId",
                  "releaseId", "createdAt", "updatedAt")
               SELECT * FROM UNNEST(
                 $1::text[], $2::text[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[],
                 $8::text[], $9::timestamp[], $10::timestamp[]
               )
               ON CONFLICT DO NOTHING"#,
        )
        .bind(&ids)
        .bind(&titles)
        .bind(&positions)
        .bind(&discs)
        .bind(&durations)
        .bind(&mb_ids)
        .bind(&recording_ids)
        .bind(&release_ids)
        .bind(&timestamps)
        .bind(&timestamps)
        .execute(pool)
        .await?;
    }

    // Rows MusicBrainz no longer lists. Deleting these still SetNulls their local links, which is
    // correct - the track genuinely left the release - and it is now the only case that does.
    let stale: Vec<String> = existing
        .iter()
        .map(|row| row.id.clone())
        .filter(|id| !keep.contains(id))
        .collect();
    if !stale.is_empty() {
        sqlx::query(r#"DELETE FROM "MusicBrainzReleaseTrack" WHERE id = ANY($1)"#)
            .bind(&stale)
            .execute(pool)
            .await?;
    }

    Ok(out)
}

/// Rebuild a bound release's `(MbRelease, Vec<MbTrack>, musicbrainzId)` straight from the DB - no MB
/// call. Used by a DB-only re-score (`tidy`), which never re-fetches a release it already synced.
/// `None` when the release row or its track list is empty (a fold/dissolve target caught mid-repair);
/// callers must defer rather than score against nothing.
pub async fn load_mb_release_with_tracks(
    pool: &PgPool,
    mb_release_db_id: &str,
) -> Result<Option<(MbRelease, Vec<MbTrack>, String)>, sqlx::Error> {
    let release_row: Option<(String, Option<String>, String, Option<String>, Option<String>, Option<String>, String)> =
        sqlx::query_as(
            r#"SELECT title, "releaseDate", status::text, disambiguation, packaging, country, "musicbrainzId"
               FROM "MusicBrainzRelease" WHERE id = $1"#,
        )
        .bind(mb_release_db_id)
        .fetch_optional(pool)
        .await?;

    let (title, release_date, status, disambiguation, packaging, country, musicbrainz_id) =
        match release_row {
            Some(r) => r,
            None => return Ok(None),
        };

    let media_rows: Vec<(i32, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT position, title, format FROM "MusicBrainzReleaseMedium" WHERE "releaseId" = $1
           ORDER BY position"#,
    )
    .bind(mb_release_db_id)
    .fetch_all(pool)
    .await?;
    let media = if media_rows.is_empty() {
        None
    } else {
        Some(
            media_rows
                .into_iter()
                .map(|(position, title, format)| MbMedia {
                    position: Some(position as u32),
                    format,
                    title,
                    track_count: None,
                    tracks: None,
                })
                .collect(),
        )
    };

    let track_rows: Vec<(
        Option<String>,
        Option<i32>,
        Option<i32>,
        Option<i32>,
        String,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT "musicbrainzId", position, "discNumber", "durationMs", title, "recordingId"
               FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(mb_release_db_id)
    .fetch_all(pool)
    .await?;

    if track_rows.is_empty() {
        return Ok(None);
    }

    let tracks = track_rows
        .into_iter()
        .filter_map(
            |(track_mb_id, position, disc_number, duration_ms, title, recording_id)| {
                Some(MbTrack {
                    id: track_mb_id?,
                    title,
                    position: position.map(|p| p as u32),
                    length: duration_ms.map(|d| d as u64),
                    disc_number: disc_number.map(|d| d as u32),
                    recording: recording_id.map(|id| MbRecordingRef { id }),
                })
            },
        )
        .collect();

    Ok(Some((
        MbRelease {
            id: musicbrainz_id.clone(),
            title,
            date: release_date,
            status: Some(status),
            disambiguation,
            packaging,
            country,
            media,
        },
        tracks,
        musicbrainz_id,
    )))
}

// ---------------------------------------------------------------------------
// Tidy: DB-only re-score of a box-touched release
// ---------------------------------------------------------------------------

/// A `LocalRelease` tidy's box pass touched (or left `UNKNOWN` from a prior interrupted run, or whose
/// track links point at the wrong release) and must re-score.
pub struct RescoreTarget {
    pub local_release_id: String,
    pub mb_release_id: String,
    pub medium_position: Option<i32>,
    pub year: Option<i32>,
    /// Picked up only because its tracks link outside its own release, not because anything this run
    /// touched it. Counted separately so the repair is measurable.
    pub stale_links_only: bool,
    /// Its stored status was `MISSING_TRACKS` - so a `COMPLETE` re-score is a scorer improvement taking
    /// effect, which `tidy --rescore-only` reports on its own line.
    pub was_missing_tracks: bool,
}

/// Targets, unioned from three sources:
///
///   1. every scoped `LocalRelease` already sitting at `matchStatus='UNKNOWN'` with a release bound (a
///      prior run's box pass that never got tidied, or index's own UNKNOWN-on-track-delete);
///   2. `touched_ids` - this run's own fold/dissolve output. Almost always a subset of (1) already, but
///      a defensive union costs nothing and guarantees this run's own work is never skipped;
///   3. any scoped release holding a `LocalReleaseTrack.mbTrackId` that belongs to a **different**
///      release than the one the folder is bound to.
///
/// Source 3 exists because (1) and (2) between them cannot see a disc the *pre-tidy, sync-era* box pass
/// dissolved: `apply_dissolve` only sets `UNKNOWN` when something changed, so a disc already moved and
/// already scored back then is at neither `UNKNOWN` nor in `touched_ids`, and its tracks keep pointing
/// at the box's track rows forever. Measured 1,336 such links across 122 releases after the 2026-09-17
/// rollout (docs/specs/spec_tidy_observations.md). `rescore_bound_release` already repairs this correctly
/// - it just never saw them. DB-only, no MusicBrainz call, and `mbTrackId` is indexed.
pub async fn get_rescore_targets(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    touched_ids: &[String],
    include_missing_tracks: bool,
) -> Result<Vec<RescoreTarget>, sqlx::Error> {
    let mut ids: Vec<String> = match scope {
        Some(artist_ids) => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                   WHERE lr."matchStatus" = 'UNKNOWN' AND lr."releaseId" IS NOT NULL
                     -- A no-guessing consensus reason (docs/no_guessing.md) always ships with
                     -- releaseId IS NULL, so this is already implied - explicit so --rescore-only
                     -- --all can never resurrect a terminal row even if that invariant ever slips.
                     AND lr."statusReason" IS NULL
                     AND lra."artistId" = ANY($1)"#,
            )
            .bind(artist_ids)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_scalar(
                r#"SELECT id FROM "LocalRelease"
                   WHERE "matchStatus" = 'UNKNOWN' AND "releaseId" IS NOT NULL AND "statusReason" IS NULL"#,
            )
            .fetch_all(pool)
            .await?
        }
    };
    let unknown_or_touched: std::collections::HashSet<String> = ids
        .iter()
        .cloned()
        .chain(touched_ids.iter().cloned())
        .collect();
    for id in touched_ids {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }

    let stale: Vec<String> = match scope {
        Some(artist_ids) => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                   JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lr.id
                   JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
                   WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId"
                     AND lra."artistId" = ANY($1)"#,
            )
            .bind(artist_ids)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lr.id
                   JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
                   WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId""#,
            )
            .fetch_all(pool)
            .await?
        }
    };
    for id in &stale {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }

    // `tidy --rescore-only`: releases already scored `MISSING_TRACKS`, so a change to the scorer's own
    // rules reaches the releases it was made for. Nothing else re-scores a release once it has a
    // status - sync only revisits what it re-matches.
    if include_missing_tracks {
        let missing: Vec<String> = match scope {
            Some(artist_ids) => {
                sqlx::query_scalar(
                    r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                       JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                       WHERE lr."matchStatus" = 'MISSING_TRACKS' AND lr."releaseId" IS NOT NULL
                         AND lra."artistId" = ANY($1)"#,
                )
                .bind(artist_ids)
                .fetch_all(pool)
                .await?
            }
            None => {
                sqlx::query_scalar(
                    r#"SELECT id FROM "LocalRelease"
                       WHERE "matchStatus" = 'MISSING_TRACKS' AND "releaseId" IS NOT NULL"#,
                )
                .fetch_all(pool)
                .await?
            }
        };
        let known: std::collections::HashSet<String> = ids.iter().cloned().collect();
        ids.extend(missing.into_iter().filter(|id| !known.contains(id)));
    }

    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let stale: std::collections::HashSet<String> = stale.into_iter().collect();
    let rows: Vec<(String, Option<String>, Option<i32>, Option<i32>, String)> = sqlx::query_as(
        r#"SELECT id, "releaseId", "mediumPosition", year, "matchStatus"::text
           FROM "LocalRelease" WHERE id = ANY($1) AND "releaseId" IS NOT NULL"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|(id, release_id, medium_position, year, status)| {
            let stale_links_only = stale.contains(&id) && !unknown_or_touched.contains(&id);
            Some(RescoreTarget {
                local_release_id: id,
                mb_release_id: release_id?,
                medium_position,
                year,
                stale_links_only,
                was_missing_tracks: status == "MISSING_TRACKS",
            })
        })
        .collect())
}

/// Outcome of a DB-only re-score: `Scored` on a normal write, `Deferred` when there is nothing to
/// score against yet (no local tracks, or the bound MB release has none) - left at `UNKNOWN`, which
/// keeps it in `get_artists_pending_sync`'s watermark clause so a plain sync's normal per-release path
/// picks it up and re-fetches it from MusicBrainz.
pub enum RescoreOutcome {
    Scored(&'static str),
    Deferred,
}

/// Re-score one already-bound `LocalRelease` against the `MusicBrainzRelease` it already points at -
/// no MusicBrainz call, no allow-list gate (it is bound already), no tag write (the next sync's
/// `write_mb_ids` owns tags), and never `update_artist_sync_stats` (tidy must never stamp
/// `lastSyncedAt` - see docs/specs/spec_tidy_script.md "Watermark traps").
pub async fn rescore_bound_release(
    pool: &PgPool,
    target: &RescoreTarget,
) -> Result<RescoreOutcome, sqlx::Error> {
    let local_tracks = get_local_tracks_for_release(pool, &target.local_release_id).await?;
    if local_tracks.is_empty() {
        return Ok(RescoreOutcome::Deferred);
    }
    let local_track_ids: Vec<String> = local_tracks.iter().map(|t| t.id.clone()).collect();
    let local_metas = crate::status::track_metas_from_rows(&local_tracks);
    let local_meta_refs: Vec<&common::types::TrackMeta> = local_metas.iter().collect();

    let Some((mb_release, mb_tracks, _mb_id)) =
        load_mb_release_with_tracks(pool, &target.mb_release_id).await?
    else {
        return Ok(RescoreOutcome::Deferred);
    };

    let status_check = crate::status::check_release_status(
        &local_meta_refs,
        &local_track_ids,
        &[(mb_release, mb_tracks)],
        target.year,
        target.medium_position,
    );

    let track_id_rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "musicbrainzId" FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(&target.mb_release_id)
    .fetch_all(pool)
    .await?;

    let track_links: Vec<(String, String)> = status_check
        .matched_mb_tracks
        .iter()
        .filter_map(|(mb_track, local_id_opt)| {
            let local_id = local_id_opt.as_ref()?;
            let db_id = track_id_rows
                .iter()
                .find(|(_, mid)| mid.as_deref() == Some(mb_track.id.as_str()))
                .map(|(db_id, _)| db_id.clone())?;
            Some((local_id.clone(), db_id))
        })
        .collect();
    let status_str = crate::status::status_to_db_string(&status_check.status);
    bind_local_release(
        pool,
        &target.local_release_id,
        &target.mb_release_id,
        status_str,
        &track_links,
    )
    .await?;

    Ok(RescoreOutcome::Scored(status_str))
}

// ---------------------------------------------------------------------------
// MusicBrainzReleaseMedium
// ---------------------------------------------------------------------------

pub struct MbMediumRow {
    pub position: i32,
    pub title: Option<String>,
    pub format: Option<String>,
    pub track_count: i32,
}

/// Build the medium rows for a release from the same audio-media filter `flatten_audio_tracks` uses,
/// so a video-only bonus disc never gets a `MusicBrainzReleaseMedium` row either. A medium with no
/// `position` is dropped - `(releaseId, position)` is the row's identity and MB always sends one.
pub fn mb_medium_rows(media: &Option<Vec<MbMedia>>) -> Vec<MbMediumRow> {
    audio_media(media)
        .into_iter()
        .filter_map(|m| {
            Some(MbMediumRow {
                position: m.position? as i32,
                title: m.title.clone(),
                format: m.format.clone(),
                track_count: m
                    .track_count
                    .map(|c| c as i32)
                    .unwrap_or_else(|| m.tracks.as_ref().map(|t| t.len() as i32).unwrap_or(0)),
            })
        })
        .collect()
}

/// Reconcile a release's stored media with what MusicBrainz just returned, keyed on `position` (MB
/// numbers media 1..N with no gaps, and `(releaseId, position)` is unique). Reconciles rather than
/// delete-and-reinsert for the same reason `sync_mb_tracks_for_release` does: a naive replace would
/// destroy `equivalentReleaseGroupId`/`equivalentReleaseId` on every sync, and the box-editions
/// equivalence pass (`box_editions::run_link_box_editions`) would have to recompute every medium's
/// equivalence from scratch every single run instead of only the ones that actually changed.
pub async fn sync_mb_media_for_release(
    pool: &PgPool,
    release_id: &str,
    media: &[MbMediumRow],
) -> Result<(), sqlx::Error> {
    let existing: Vec<(String, i32)> = sqlx::query_as(
        r#"SELECT id, position FROM "MusicBrainzReleaseMedium" WHERE "releaseId" = $1"#,
    )
    .bind(release_id)
    .fetch_all(pool)
    .await?;
    let by_position: HashMap<i32, String> = existing.into_iter().map(|(id, p)| (p, id)).collect();

    let now = Utc::now().naive_utc();
    let positions: Vec<i32> = media.iter().map(|m| m.position).collect();

    for m in media {
        match by_position.get(&m.position) {
            Some(id) => {
                sqlx::query(
                    r#"UPDATE "MusicBrainzReleaseMedium"
                       SET title = $2, format = $3, "trackCount" = $4, "updatedAt" = $5
                       WHERE id = $1"#,
                )
                .bind(id)
                .bind(&m.title)
                .bind(&m.format)
                .bind(m.track_count)
                .bind(now)
                .execute(pool)
                .await?;
            }
            None => {
                let id = cuid2::create_id();
                sqlx::query(
                    r#"INSERT INTO "MusicBrainzReleaseMedium"
                         (id, "releaseId", position, title, format, "trackCount", "createdAt", "updatedAt")
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                       ON CONFLICT ("releaseId", position) DO UPDATE SET
                         title = EXCLUDED.title, format = EXCLUDED.format,
                         "trackCount" = EXCLUDED."trackCount", "updatedAt" = EXCLUDED."updatedAt""#,
                )
                .bind(&id)
                .bind(release_id)
                .bind(m.position)
                .bind(&m.title)
                .bind(&m.format)
                .bind(m.track_count)
                .bind(now)
                .execute(pool)
                .await?;
            }
        }
    }

    // A medium MusicBrainz no longer lists (a rare release edit) - drop it. Its equivalence, if any,
    // goes with it; the next box-editions equivalence pass recomputes what remains.
    sqlx::query(
        r#"DELETE FROM "MusicBrainzReleaseMedium" WHERE "releaseId" = $1 AND position <> ALL($2)"#,
    )
    .bind(release_id)
    .bind(&positions)
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Artist–Genre links
// ---------------------------------------------------------------------------

pub async fn batch_link_artist_genres(
    pool: &PgPool,
    artist_id: &str,
    genre_ids: &[String],
) -> Result<(), sqlx::Error> {
    if genre_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"INSERT INTO "_ArtistGenres" ("A", "B")
           SELECT $1, unnest($2::text[])
           ON CONFLICT DO NOTHING"#,
    )
    .bind(artist_id)
    .bind(genre_ids)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_artist_genre_ids(pool: &PgPool, artist_id: &str) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as(r#"SELECT "B" FROM "_ArtistGenres" WHERE "A" = $1"#)
        .bind(artist_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.into_iter().map(|(id,)| id).collect()
}

pub async fn cleanup_empty_connected_artists(
    pool: &PgPool,
    mb_id: &str,
    exclude_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"DELETE FROM "Artist"
           WHERE "musicbrainzId" = $1
             AND id != $2
             AND "primaryArtistId" IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" WHERE "artistId" = "Artist".id
             )"#,
    )
    .bind(mb_id)
    .bind(exclude_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---------------------------------------------------------------------------
// Artist URL upsert
// ---------------------------------------------------------------------------

pub async fn batch_upsert_artist_urls(
    pool: &PgPool,
    artist_id: &str,
    urls: &[(String, String)], // (type, url)
) -> Result<(), sqlx::Error> {
    if urls.is_empty() {
        return Ok(());
    }
    let len = urls.len();
    let ids: Vec<String> = (0..len).map(|_| cuid2::create_id()).collect();
    let artist_ids: Vec<&str> = vec![artist_id; len];
    let types: Vec<&str> = urls.iter().map(|(t, _)| t.as_str()).collect();
    let url_vals: Vec<&str> = urls.iter().map(|(_, u)| u.as_str()).collect();
    let now = Utc::now().naive_utc();
    let timestamps: Vec<NaiveDateTime> = vec![now; len];

    sqlx::query(
        r#"INSERT INTO "ArtistUrl" (id, "artistId", type, url, "createdAt", "updatedAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamp[], $6::timestamp[])
           ON CONFLICT ("artistId", type, url) DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&artist_ids)
    .bind(&types)
    .bind(&url_vals)
    .bind(&timestamps)
    .bind(&timestamps)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// LocalRelease → MusicBrainzRelease link
// ---------------------------------------------------------------------------

pub async fn update_local_release_match(
    executor: impl sqlx::PgExecutor<'_>,
    local_release_id: &str,
    mb_release_id: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "releaseId" = $1,
               "matchStatus" = $2::"ReleaseStatus",
               "statusReason" = NULL,
               "updatedAt" = $3
           WHERE id = $4"#,
    )
    .bind(mb_release_id)
    .bind(status)
    .bind(now)
    .bind(local_release_id)
    .execute(executor)
    .await?;
    Ok(())
}

/// Bind a local release to an MB release in one transaction: link the matched tracks, clear every
/// other track's `mbTrackId` (stale links from an earlier binding or a fold), set release + status.
/// A failure leaves the previous binding intact.
pub async fn bind_local_release(
    pool: &PgPool,
    local_release_id: &str,
    mb_release_id: &str,
    status: &str,
    links: &[(String, String)], // (local_track_id, mb_track_id)
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    link_local_tracks_to_mb(&mut *tx, links).await?;
    let matched: Vec<&str> = links.iter().map(|(l, _)| l.as_str()).collect();
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET "mbTrackId" = NULL
           WHERE "localReleaseId" = $1 AND "mbTrackId" IS NOT NULL AND id <> ALL($2)"#,
    )
    .bind(local_release_id)
    .bind(&matched)
    .execute(&mut *tx)
    .await?;
    update_local_release_match(&mut *tx, local_release_id, mb_release_id, status).await?;
    tx.commit().await
}

/// Unbind a release, and its tracks with it. Clearing only `releaseId` used to leave every track still
/// linked to the old release's track rows: an Unmatched release whose tracks claimed to be specific
/// MusicBrainz recordings, and - because `delete_orphaned_mb_releases` keeps any release a track still
/// points at - an old binding that could never be swept away.
pub async fn mark_local_release_unmatched(
    pool: &PgPool,
    local_release_id: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "releaseId" = NULL,
               "matchStatus" = 'UNMATCHED',
               "statusReason" = NULL,
               "updatedAt" = $1
           WHERE id = $2"#,
    )
    .bind(now)
    .bind(local_release_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET "mbTrackId" = NULL, "updatedAt" = $1
           WHERE "localReleaseId" = $2 AND "mbTrackId" IS NOT NULL"#,
    )
    .bind(now)
    .bind(local_release_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// LocalReleaseTrack → MusicBrainzReleaseTrack link
// ---------------------------------------------------------------------------

pub async fn link_local_tracks_to_mb(
    executor: impl sqlx::PgExecutor<'_>,
    links: &[(String, String)], // (local_track_id, mb_track_id)
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }
    let local_ids: Vec<&str> = links.iter().map(|(l, _)| l.as_str()).collect();
    let mb_ids: Vec<&str> = links.iter().map(|(_, m)| m.as_str()).collect();
    let now = Utc::now().naive_utc();

    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" AS t
           SET "mbTrackId" = u.mb_id, "updatedAt" = $3
           FROM UNNEST($1::text[], $2::text[]) AS u(local_id, mb_id)
           WHERE t.id = u.local_id"#,
    )
    .bind(&local_ids)
    .bind(&mb_ids)
    .bind(now)
    .execute(executor)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Artist sync stats
// ---------------------------------------------------------------------------

/// `mark_synced = false` persists the MB id and country but leaves `lastSyncedAt`, so an artist whose
/// release groups could not be fetched stays pending.
pub async fn update_artist_sync_stats(
    pool: &PgPool,
    artist_id: &str,
    mb_id: &str,
    country: Option<&str>,
    mark_synced: bool,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "Artist"
           SET "musicbrainzId" = $1,
               "lastSyncedAt" = CASE WHEN $5 THEN $2 ELSE "lastSyncedAt" END,
               "updatedAt" = $2,
               "country" = $3
           WHERE id = $4"#,
    )
    .bind(mb_id)
    .bind(now)
    .bind(country)
    .bind(artist_id)
    .bind(mark_synced)
    .execute(pool)
    .await?;
    Ok(())
}

// Moved to `common::totals` so `delete --release` can call it too, without depending on this bin-only
// crate - re-exported here so the `db::*` glob import in main.rs keeps working unchanged.
pub use common::totals::recompute_artist_completeness;

// Set-based backfill of recompute_artist_completeness for every artist. Returns the count of
// artists with a determinable album/EP catalogue that got a completeness value; artists without
// one are reset to NULL. UNKNOWN/UNMATCHED releases are excluded from the catalogue entirely (see
// common::totals::recompute_artist_completeness) - both queries below filter them out, or an
// artist with only UNKNOWN/UNMATCHED releases would wrongly look like it has none. Runs in
// seconds.
pub async fn recompute_all_completeness(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let scored = sqlx::query(
        r#"UPDATE "Artist" a
           SET "completeness" = sub.completeness, "updatedAt" = NOW()
           FROM (
             SELECT mra."artistId" AS aid,
                    COUNT(*) FILTER (WHERE mr.status::text = 'COMPLETE')::float8 / COUNT(*) AS completeness
             FROM "MusicBrainzReleaseArtist" mra
             JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
             JOIN "ReleaseType" rt ON rt.id = mr."typeId"
             WHERE rt.slug IN ('album', 'ep')
               AND mr.status::text NOT IN ('UNKNOWN', 'UNMATCHED')
             GROUP BY mra."artistId"
           ) sub
           WHERE a.id = sub.aid"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"UPDATE "Artist" a
           SET "completeness" = NULL, "updatedAt" = NOW()
           WHERE a."completeness" IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
               FROM "MusicBrainzReleaseArtist" mra
               JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
               JOIN "ReleaseType" rt ON rt.id = mr."typeId"
               WHERE mra."artistId" = a.id AND rt.slug IN ('album', 'ep')
                 AND mr.status::text NOT IN ('UNKNOWN', 'UNMATCHED')
             )"#,
    )
    .execute(pool)
    .await?;

    Ok(scored.rows_affected())
}

// ---------------------------------------------------------------------------
// Release–Genre links
// ---------------------------------------------------------------------------

pub async fn batch_link_release_genres(
    pool: &PgPool,
    release_id: &str,
    genre_ids: &[String],
) -> Result<(), sqlx::Error> {
    if genre_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"INSERT INTO "_ReleaseGenres" ("A", "B")
           SELECT unnest($1::text[]), $2
           ON CONFLICT DO NOTHING"#,
    )
    .bind(genre_ids)
    .bind(release_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Cleanup: delete MusicBrainzRelease rows no LocalRelease points to
// ---------------------------------------------------------------------------

/// Artist ids this run is allowed to clean up after, or `None` for the whole library.
///
/// A `--only`/`--artist-ids`/`--release` run must not garbage-collect rows for artists it never
/// synced. The MB variant below is the reason this type exists: unscoped, a one-artist sync deletes
/// every non-MISSING `MusicBrainzRelease` in the library that happens to be unbound at that instant -
/// including a perfectly real release whose `LocalRelease` index had just regrouped, for an artist the
/// run never looked at. Only an unfiltered run has the whole picture.
pub type ArtistScope<'a> = Option<&'a [String]>;

/// Rebuild `MusicBrainzReleaseMedium` rows and `mediumCount` for releases that predate them, from the
/// disc numbers their own tracks already carry. Pure SQL, no MusicBrainz call, idempotent: once a release
/// has medium rows it is never selected again.
///
/// Discs were first modelled on 2026-09-06/07 (the `box_sets`/`multidisk` migrations). Those migrations
/// defaulted `mediumCount` to 1 and never backfilled existing releases, so everything synced 2026-08-31 to
/// 09-06 and not re-synced since kept `mediumCount = 1` and no medium rows - while its tracks carried disc
/// numbers 1, 2, ... all along. Measured on 2026-09-18: 3,602 releases. Nothing writes this shape today;
/// sync's binding path records media properly.
///
/// It matters because every multi-disc decision keys off `mediumCount > 1`: such a release is invisible
/// to the box pass, and each disc folder bound to it is scored against the *whole* multi-disc tracklist -
/// 1,745 local releases `MISSING_TRACKS` purely for that reason (docs/specs/spec_tidy_observations.md §15).
///
/// Only releases where **every** track has a disc number and there are at least two distinct ones. A
/// release with a single disc number is a genuine single medium and is left exactly as it is. Medium
/// titles and formats are not recoverable from tracks and stay NULL; nothing downstream requires them
/// (the containment tier of `box_editions` simply skips an untitled medium).
pub async fn backfill_media_from_track_discs(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    let targets: Vec<String> = sqlx::query_scalar(
        r#"SELECT r.id FROM "MusicBrainzRelease" r
           WHERE NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseMedium" md WHERE md."releaseId" = r.id)
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseTrack" t
                             WHERE t."releaseId" = r.id AND t."discNumber" IS NULL)
             AND (SELECT count(DISTINCT t."discNumber") FROM "MusicBrainzReleaseTrack" t
                  WHERE t."releaseId" = r.id) > 1"#,
    )
    .fetch_all(&mut *tx)
    .await?;
    if targets.is_empty() {
        tx.commit().await?;
        return Ok(0);
    }
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseMedium" (id, "releaseId", position, "trackCount", "createdAt", "updatedAt")
           SELECT md5(t."releaseId" || ':' || t."discNumber"), t."releaseId", t."discNumber", count(*), $2, $2
           FROM "MusicBrainzReleaseTrack" t
           WHERE t."releaseId" = ANY($1)
           GROUP BY t."releaseId", t."discNumber"
           ON CONFLICT ("releaseId", position) DO NOTHING"#,
    )
    .bind(&targets)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE "MusicBrainzRelease" r
           SET "mediumCount" = (SELECT count(DISTINCT t."discNumber") FROM "MusicBrainzReleaseTrack" t
                                WHERE t."releaseId" = r.id),
               "updatedAt" = $2
           WHERE r.id = ANY($1)"#,
    )
    .bind(&targets)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(targets.len() as u64)
}

/// Sync/tidy entry point for [`common::cleanup::delete_orphaned_mb_releases`], scoped by artist.
/// Must run before `retire_owned_missing_placeholders` at every call site.
pub async fn delete_orphaned_mb_releases(
    pool: &PgPool,
    scope: ArtistScope<'_>,
) -> Result<u64, sqlx::Error> {
    let scope = match scope {
        Some(artist_ids) => common::cleanup::MbSweepScope::Artists(artist_ids),
        None => common::cleanup::MbSweepScope::All,
    };
    common::cleanup::delete_orphaned_mb_releases(pool, scope).await
}

/// Scoped to releases owned by `scope`'s artists. An *ownerless* empty release is left to the global
/// pass - nothing attributes it to the artists this run synced.
pub async fn delete_empty_local_releases(
    pool: &PgPool,
    scope: ArtistScope<'_>,
) -> Result<u64, sqlx::Error> {
    let result = match scope {
        Some(artist_ids) => {
            sqlx::query(
                r#"DELETE FROM "LocalRelease" lr
                   WHERE NOT EXISTS (
                           SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                         )
                     AND EXISTS (
                           SELECT 1 FROM "LocalReleaseArtist" lra
                           WHERE lra."localReleaseId" = lr.id AND lra."artistId" = ANY($1::text[])
                         )"#,
            )
            .bind(artist_ids)
            .execute(pool)
            .await?
        }
        None => {
            sqlx::query(
                r#"DELETE FROM "LocalRelease" lr
                   WHERE NOT EXISTS (
                       SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                   )"#,
            )
            .execute(pool)
            .await?
        }
    };
    Ok(result.rows_affected())
}

// Never delete a MISSING placeholder that a live DownloadedRelease still points at — the web app's
// auto-downloader keys its dedup/retry logic off that row, so dropping it orphans the queue entry and
// lets the trickle worker re-fetch the same release as if it were brand new.
//
// "Live" is the states that can still consume the target (DOWNLOADING/ENRICHING/READY/PROMOTED). The
// dead ends (REJECTED, FAILED, ABANDONED, UNAVAILABLE, INVALID) used to pin it too, which meant a gap
// the catalogue filter now rejects could never be swept: the bootleg live recordings the pre-filter
// gap pass invented were all rejected by the downloader, and their rejection rows kept the bogus
// MISSING entries alive through every re-sync. Orphaning those is safe - `acquire.post.ts` dedups on
// the stable `releaseGroupId` whenever there is one, and every gap row carries it.
pub async fn delete_missing_releases_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease"
           WHERE status = 'MISSING'
             AND id IN (
               SELECT "releaseId" FROM "MusicBrainzReleaseArtist"
               WHERE "artistId" = $1
             )
             AND id NOT IN (
               SELECT "mbReleaseId" FROM "DownloadedRelease"
               WHERE "mbReleaseId" IS NOT NULL
                 AND status IN ('DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED')
             )"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// Cover set = this artist + every connected (duplicate-merged) artist, matching the web artist page's
// own aggregation (releases.get.ts's allArtistIds = primary + Artist.findMany({primaryArtistId})).
// Without this, a release owned only under a connected artist's LocalReleaseArtist link stayed
// "uncovered" here, so catalogue-gaps created a MISSING placeholder and the trickle worker
// re-downloaded an album the library already had (landing under the connected artist's folder).
/// Errors propagate: an empty set would turn every owned album into a MISSING gap.
pub async fn get_covered_release_group_ids(
    pool: &PgPool,
    artist_id: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    // Two ways a group counts as owned:
    //   1. a LocalRelease is bound to one of its releases (the ordinary case), or
    //   2. it is a dissolved box (docs/sync_decisions.md): a box's own release has no bind
    //      on its own release group once its discs are dissolved onto their equivalent albums, so
    //      without this branch every dissolved box reads MISSING and gets re-downloaded whole. A
    //      multi-medium release counts covered when EVERY one of its media is covered — bound at
    //      that mediumPosition directly, OR its equivalentReleaseId itself has a bind, OR a
    //      LocalRelease carries boxReleaseId/boxMediumPosition pointing at it (a rarities disc bound
    //      straight to the box).
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "LocalRelease" lr ON lr."releaseId" = mbr.id
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           JOIN "Artist" a ON a.id = lra."artistId"
           WHERE (lra."artistId" = $1 OR a."primaryArtistId" = $1)
             AND mbr."releaseGroupId" IS NOT NULL
           UNION
           SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra3 ON mra3."releaseId" = mbr.id
           JOIN "Artist" a3 ON a3.id = mra3."artistId"
           WHERE (mra3."artistId" = $1 OR a3."primaryArtistId" = $1)
             AND mbr."releaseGroupId" IS NOT NULL
             AND mbr."mediumCount" > 1
             AND NOT EXISTS (
               SELECT 1 FROM "MusicBrainzReleaseMedium" m
               WHERE m."releaseId" = mbr.id
                 AND NOT (
                   EXISTS (
                     SELECT 1 FROM "LocalRelease" lr2
                     WHERE lr2."releaseId" = mbr.id AND lr2."mediumPosition" = m.position
                   )
                   OR (
                     m."equivalentReleaseId" IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM "LocalRelease" lr3 WHERE lr3."releaseId" = m."equivalentReleaseId"
                     )
                   )
                   OR EXISTS (
                     SELECT 1 FROM "LocalRelease" lr4
                     WHERE lr4."boxReleaseId" = mbr.id AND lr4."boxMediumPosition" = m.position
                   )
                 )
             )"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Release group -> containment note, for this artist's existing MISSING gaps.
///
/// Snapshotted before the gap pass wipes and rewrites those rows. Re-applying a note costs nothing;
/// re-deriving it costs one MusicBrainz call per group, so an ordinary sync carries the note forward
/// and only `--overwrite` pays to re-check it.
/// Sweep `primaryArtistId` links that should never have been made, in one pass.
///
/// Two artist rows are the same artist only when **both names resolve to the same MusicBrainz id**
/// (CLAUDE.md's rule for this column). The 33 links found in this library all break it, in three
/// different ways, and they need three different answers - "the row that owns the releases wins" is
/// not one of them:
///
///   * Same id on both sides - a genuine alias ("Grover Washington, Jr." / "Grover Washington").
///     Promote the row that owns the releases.
///   * Different ids, or either side unresolved - not the same artist at all. "Faith" was filed under
///     "Percy Faith", "Forest" under "Deep Forest", and collaboration names like "Indica Dubs meets
///     Vibronics" under "Indica Dubs". Swapping these would only invert the error and make the
///     collaboration outrank the real artist, so the link is removed and both stand on their own.
///   * A primary whose stored id contradicts its own name ("Wardell Gray Quintet" holding Erroll
///     Garner's id) also gives that id up - it is what dragged the releases across in the first place.
///
/// Pure SQL, no MusicBrainz calls. Returns one row per repair for reporting.
pub struct IdentityRepair {
    pub artist: String,
    pub releases: i64,
    pub other: String,
    pub action: &'static str,
}

pub async fn repair_all_empty_primaries(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<IdentityRepair>, sqlx::Error> {
    let pairs: Vec<(String, String, i64, String, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"SELECT d.id, d.name,
                      (SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId" = d.id) AS n_local,
                      p.id, p.name,
                      (SELECT l.mbid FROM "MbArtistLookup" l WHERE l.name = d.name AND l.mbid IS NOT NULL LIMIT 1),
                      (SELECT l.mbid FROM "MbArtistLookup" l WHERE l.name = p.name AND l.mbid IS NOT NULL LIMIT 1),
                      p."musicbrainzId"
               FROM "Artist" d
               JOIN "Artist" p ON p.id = d."primaryArtistId"
               WHERE EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = d.id)
                 AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = p.id)
               ORDER BY 3 DESC"#,
        )
        .fetch_all(pool)
        .await?;

    let mut done = Vec::new();
    for (
        dup_id,
        dup_name,
        n_local,
        empty_id,
        empty_name,
        dup_mbid,
        empty_mbid,
        empty_stored_mbid,
    ) in pairs
    {
        let same_artist = match (dup_mbid.as_deref(), empty_mbid.as_deref()) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        };

        let action = if same_artist {
            if !dry_run {
                promote_over_empty_primary(pool, &dup_id).await?;
            }
            "promoted over an alias of itself"
        } else {
            if !dry_run {
                sqlx::query(
                    r#"UPDATE "Artist" SET "primaryArtistId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
                )
                .bind(&dup_id)
                .execute(pool)
                .await?;
                // A stored id that contradicts the row's own name is what moved the releases across.
                if let (Some(stored), Some(resolved)) =
                    (empty_stored_mbid.as_deref(), empty_mbid.as_deref())
                {
                    if stored != resolved {
                        sqlx::query(
                            r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
                        )
                        .bind(&empty_id)
                        .execute(pool)
                        .await?;
                    }
                }
            }
            "unlinked - not the same artist"
        };

        done.push(IdentityRepair {
            artist: dup_name,
            releases: n_local,
            other: empty_name,
            action,
        });
    }
    Ok(done)
}

/// Repair a `primaryArtistId` that points at an artist owning nothing.
///
/// Duplicate detection used to accept *any* other row holding the same MusicBrainz id as the primary,
/// with no `ORDER BY` and no check that it owned anything. Whichever row a sync happened to reach
/// first won, so a stray credit-only row could - and did - end up canonical over the row holding the
/// entire discography: 35 artists in this library, including "Dylan" (0 releases) standing in front of
/// "Bob Dylan" (72), and "Wardell Gray Quintet" (0) in front of "Erroll Garner" (76). The artist page
/// then renders under the wrong name and the real row is unreachable.
///
/// Callers reach here only once the current artist is known to own local releases, so "primary owns
/// nothing" is unambiguous: swap the two. The empty row becomes the duplicate, which also makes it
/// eligible for `cleanup_empty_connected_artists` to remove entirely.
///
/// Returns the demoted artist's name when a swap happened, for reporting.
pub async fn promote_over_empty_primary(
    pool: &PgPool,
    artist_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let demoted: Option<(String, String)> = sqlx::query_as(
        r#"SELECT p.id, p.name
           FROM "Artist" a
           JOIN "Artist" p ON p.id = a."primaryArtistId"
           WHERE a.id = $1
             AND NOT EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = p.id
             )"#,
    )
    .bind(artist_id)
    .fetch_optional(pool)
    .await?;

    let Some((empty_id, empty_name)) = demoted else {
        return Ok(None);
    };

    // Order matters: clear the current row first, or the second statement would point the empty row
    // at an artist that is still itself marked a duplicate, making a two-row cycle.
    sqlx::query(
        r#"UPDATE "Artist" SET "primaryArtistId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    // The demoted row also gives up its MusicBrainz id, because that claim is what caused the
    // mis-filing in the first place. "Wardell Gray Quintet" (0 releases) was holding Erroll Garner's
    // MusicBrainz id - not its own, which is a different id entirely - so Erroll Garner's 76 releases
    // resolved onto it and filed themselves under that name. Leaving the id on the demoted row lets
    // two rows claim one artist, and the next sync can re-link them the same way round again.
    sqlx::query(
        r#"UPDATE "Artist"
           SET "primaryArtistId" = $1, "musicbrainzId" = NULL, "updatedAt" = NOW()
           WHERE id = $2 AND id <> $1"#,
    )
    .bind(artist_id)
    .bind(&empty_id)
    .execute(pool)
    .await?;

    Ok(Some(empty_name))
}

/// One artist whose stored id `MbArtistLookup` independently contradicts, for the dry-run report.
#[derive(Debug, Clone)]
pub struct ContradictedIdentity {
    pub artist: String,
    pub releases: i64,
    pub cleared_mbid: String,
}

/// Pass B of `--repair-artist-identities`: null a stored id the lookup table confidently disagrees
/// with, anywhere in the library - not just the `primaryArtistId`-linked pairs Pass A
/// (`repair_all_empty_primaries`) handles.
///
/// "Confidently disagrees" means `MbArtistLookup` has a row for this artist's exact name with a
/// **different, non-null** id - a `CONTRADICTS` row in the docs/sync_decisions.md §17 measurement.
/// A row with no cached answer, or a cached miss (`mbid IS NULL`), is left alone: neither is evidence
/// against the stored id, only the absence of evidence for it - see `common::mb::names::IdentityVerdict`.
/// Same "no wild guesses" rule as the ladder gate: withhold, never invent.
///
/// Also deletes the artist's derived `MusicBrainzReleaseArtist` rows, so the wrong discography stops
/// rendering immediately rather than lingering until the next sync. Must ship after the ladder gate
/// (§5) or the next un-gated sync re-mints the same id right back - see §6.
pub async fn repair_contradicted_identities(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<ContradictedIdentity>, sqlx::Error> {
    let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
        r#"SELECT a.id, a.name,
                  (SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id),
                  a."musicbrainzId"
           FROM "Artist" a
           JOIN "MbArtistLookup" l ON l.name = a.name
           WHERE l.mbid IS NOT NULL
             AND l.mbid <> a."musicbrainzId"
             AND a."musicbrainzId" IS NOT NULL
             AND a."musicbrainzId" <> ''
           ORDER BY a.name"#,
    )
    .fetch_all(pool)
    .await?;

    let mut done = Vec::with_capacity(rows.len());
    for (id, name, n_local, old_mbid) in rows {
        if !dry_run {
            sqlx::query(
                r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "lastSyncedAt" = NULL, "updatedAt" = NOW()
                   WHERE id = $1"#,
            )
            .bind(&id)
            .execute(pool)
            .await?;
            sqlx::query(r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#)
                .bind(&id)
                .execute(pool)
                .await?;
        }
        done.push(ContradictedIdentity {
            artist: name,
            releases: n_local,
            cleared_mbid: old_mbid,
        });
    }
    Ok(done)
}

/// One shared-id group `--repair-artist-identities` Pass C resolved (or left alone), for the report.
#[derive(Debug, Clone)]
pub struct SharedIdentityGroup {
    pub mbid: String,
    pub kept: Option<String>,
    pub cleared: Vec<String>,
}

/// Pass C of `--repair-artist-identities`: two or more *unrelated* Artist rows (no `primaryArtistId`
/// link between them - Pass A already owns that legitimate-alias case) holding the exact same
/// MusicBrainz id. One artist cannot correctly be two different names at once, so at most one member
/// of the group keeps the id.
///
/// "No wild guesses": the id is kept only where exactly one member's own name is confirmed by
/// `MbArtistLookup` for that exact id. If more than one member is confirmed, this is a genuine
/// ambiguity this pass cannot resolve safely and the group is left untouched for a human to look at.
/// If none is confirmed, every member gives the id up - an unconfirmed guess is exactly what created
/// the shared-id bug in the first place, and this pass exists to stop repeating it, not to make a
/// better-informed version of the same mistake.
pub async fn repair_shared_identities(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<SharedIdentityGroup>, sqlx::Error> {
    let mbids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "musicbrainzId" FROM "Artist"
           WHERE "musicbrainzId" IS NOT NULL AND "musicbrainzId" <> ''
             AND "primaryArtistId" IS NULL
           GROUP BY "musicbrainzId"
           HAVING count(*) > 1"#,
    )
    .fetch_all(pool)
    .await?;

    let mut done = Vec::with_capacity(mbids.len());
    for (mbid,) in mbids {
        let members: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT id, name FROM "Artist"
               WHERE "musicbrainzId" = $1 AND "primaryArtistId" IS NULL"#,
        )
        .bind(&mbid)
        .fetch_all(pool)
        .await?;

        let mut confirmed: Vec<(String, String)> = Vec::new();
        for (id, name) in &members {
            let hit: Option<(String,)> = sqlx::query_as(
                r#"SELECT mbid FROM "MbArtistLookup" WHERE name = $1 AND mbid = $2"#,
            )
            .bind(name)
            .bind(&mbid)
            .fetch_optional(pool)
            .await?;
            if hit.is_some() {
                confirmed.push((id.clone(), name.clone()));
            }
        }

        if confirmed.len() > 1 {
            continue;
        }
        let kept_id = confirmed.first().map(|(id, _)| id.clone());
        let kept_name = confirmed.first().map(|(_, name)| name.clone());

        let mut cleared = Vec::new();
        for (id, name) in &members {
            if kept_id.as_deref() == Some(id.as_str()) {
                continue;
            }
            cleared.push(name.clone());
            if !dry_run {
                sqlx::query(
                    r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "lastSyncedAt" = NULL, "updatedAt" = NOW()
                       WHERE id = $1"#,
                )
                .bind(id)
                .execute(pool)
                .await?;
                sqlx::query(r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
        }
        done.push(SharedIdentityGroup {
            mbid,
            kept: kept_name,
            cleared,
        });
    }
    Ok(done)
}

pub async fn get_contained_notes_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> HashMap<String, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId", mbr."statusReason"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mbr.id
           WHERE mra."artistId" = $1
             AND mbr.status = 'MISSING'
             AND mbr."releaseGroupId" IS NOT NULL
             AND mbr."statusReason" IS NOT NULL"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().collect()
}

/// Every local release of this artist with its track ids + titles — the candidate containers for
/// `owned::detect_containment`. One query per artist; only pulled when there are gaps to test.
pub async fn get_local_bundles_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Vec<crate::owned::LocalBundle> {
    let rows: Vec<(String, String, String, String, Option<i32>)> = sqlx::query_as(
        r#"SELECT lr.id, lr.title, lrt.id, COALESCE(lrt.title, ''), lrt.duration
           FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           JOIN "Artist" a ON a.id = lra."artistId"
           JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
           WHERE (lra."artistId" = $1 OR a."primaryArtistId" = $1)
           ORDER BY lr.id, lrt."discNumber" NULLS FIRST, lrt."trackNumber" NULLS FIRST"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut bundles: Vec<crate::owned::LocalBundle> = Vec::new();
    for (release_id, release_title, track_id, track_title, duration) in rows {
        match bundles.last_mut() {
            Some(last) if last.release_id == release_id => {
                last.tracks.push((track_id, track_title, duration))
            }
            _ => bundles.push(crate::owned::LocalBundle {
                release_id,
                title: release_title,
                tracks: vec![(track_id, track_title, duration)],
            }),
        }
    }
    bundles
}

pub async fn get_missing_release_group_ids_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mbr.id
           WHERE mra."artistId" = $1
             AND mbr.status = 'MISSING'
             AND mbr."releaseGroupId" IS NOT NULL"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

// ---------------------------------------------------------------------------
// Get artists pending sync (lastIndexedAt > lastSyncedAt OR never synced)
// ---------------------------------------------------------------------------

pub struct ArtistSyncRow {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub mb_id: Option<String>,
    pub has_image: bool,
}

pub async fn get_artists_pending_sync(pool: &PgPool) -> Result<Vec<ArtistSyncRow>, sqlx::Error> {
    let rows: Vec<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        // An artist also counts as pending when any of its releases is sitting at UNKNOWN.
        //
        // UNKNOWN means "score this again": index sets it when it deletes tracks from a matched
        // release, and dissolving a box set sets it on every disc it re-binds. The timestamp test
        // alone never sees the second case - dissolving happens inside sync itself, long after that
        // artist's own `lastSyncedAt` was stamped - so a freshly dissolved box stayed UNKNOWN until
        // somebody happened to run `--overwrite` over it. ABBA's nine-disc box did exactly that:
        // bound and dissolved correctly, then showed nine unscored discs.
        r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl"
               FROM "Artist" a
               WHERE "lastIndexedAt" IS NOT NULL
                 AND (
                   "lastSyncedAt" IS NULL
                   OR "lastIndexedAt" > "lastSyncedAt"
                   OR EXISTS (
                     SELECT 1 FROM "LocalRelease" lr
                     JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                     WHERE lra."artistId" = a.id AND lr."matchStatus" = 'UNKNOWN'
                       -- A no-guessing consensus reason (docs/no_guessing.md) is terminal: without
                       -- this a flagged release would requeue its artist on every run, forever.
                       AND lr."statusReason" IS NULL
                   )
                 )
               ORDER BY name"#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
            id,
            name,
            slug,
            mb_id: mb_id.as_deref().and_then(sanitize_mb_id),
            has_image: image.is_some() || image_url.is_some(),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Tidy watermark (Artist.lastTidiedAt)
// ---------------------------------------------------------------------------

/// Artist (id, name) pairs tidy has fresh work for: synced at least once, and either never tidied or
/// synced again since its last tidy. `lastSyncedAt IS NOT NULL` excludes an artist sync has not reached
/// yet - tidy runs after sync in every caller, never instead of it. Names come along so `--only`/
/// `--from`/`--to` can narrow this set the same way sync's own filters do.
pub async fn get_artists_pending_tidy(pool: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, name FROM "Artist"
           WHERE "lastSyncedAt" IS NOT NULL
             AND ("lastTidiedAt" IS NULL OR "lastSyncedAt" > "lastTidiedAt")
           ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
}

/// Every artist (id, name) sync has ever reached, for `--all` (which ignores the watermark, but can
/// still be narrowed further by `--only`/`--from`/`--to` the same way the watermark set can).
pub async fn get_all_synced_artists(pool: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, name FROM "Artist" WHERE "lastSyncedAt" IS NOT NULL ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
}

/// Stamp `lastTidiedAt` for exactly the artists this run scoped and finished clean. Never called for a
/// run that was interrupted or hit a phase error - those artists must stay pending so the next tidy
/// redoes them (docs/specs/spec_tidy_script.md "Watermark traps").
pub async fn stamp_artists_tidied(
    pool: &PgPool,
    artist_ids: &[String],
    at: NaiveDateTime,
) -> Result<(), sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(r#"UPDATE "Artist" SET "lastTidiedAt" = $1 WHERE id = ANY($2)"#)
        .bind(at)
        .bind(artist_ids)
        .execute(pool)
        .await?;
    Ok(())
}

/// `--all`: stamp every artist sync has ever reached, not just the ids this run happened to scope
/// (a whole-library run's scope is implicitly "every synced artist").
pub async fn stamp_all_tidied(pool: &PgPool, at: NaiveDateTime) -> Result<(), sqlx::Error> {
    sqlx::query(r#"UPDATE "Artist" SET "lastTidiedAt" = $1 WHERE "lastSyncedAt" IS NOT NULL"#)
        .bind(at)
        .execute(pool)
        .await?;
    Ok(())
}

/// Owning artist ids for a set of `LocalRelease` ids - step 8's score recompute must cover not just
/// the artists this run scoped, but every owner of a release the box pass or re-score actually
/// touched (a sibling group frequently spans more than one artist's folders).
pub async fn get_owner_artist_ids_for_releases(
    pool: &PgPool,
    local_release_ids: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    if local_release_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar(
        r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist" WHERE "localReleaseId" = ANY($1)"#,
    )
    .bind(local_release_ids)
    .fetch_all(pool)
    .await
}

// ---------------------------------------------------------------------------
// Get local releases for an artist (to sync against MB)
// ---------------------------------------------------------------------------

pub struct LocalReleaseRow {
    pub id: String,
    pub title: String,
    pub year: Option<i32>,
    pub forced_complete: bool,
    pub release_id: Option<String>,
    pub match_status: Option<String>,
    pub has_cover: bool,
    // Which medium of release_id this folder is (docs/sync_decisions.md) - set by a prior box-dissolve
    // bind. Must be respected on every re-sync, or a later run would re-score a dissolved box disc
    // against its target's *whole* tracklist and silently undo the fix.
    pub medium_position: Option<i32>,
    /// MusicBrainz id of the release this folder is already bound to, when the box pass put it there
    /// - either dissolved onto a standalone release (`boxReleaseId`) or kept on the box itself
    ///   (`mediumPosition`). The folder's own tags name a different release than the box pass chose, so
    ///   without this the per-release matcher re-binds it from the tag on every run while the box pass
    ///   re-points it back - the two fight, and the disc never settles on a score. See its use in main.rs.
    pub dissolved_bound_mb_id: Option<String>,
    /// Whether this folder is a fold survivor (`LocalReleaseMember` rows exist) - a folded release
    /// legitimately mixes per-disc album tags, so the consensus gate exempts it same as a dissolved
    /// box disc.
    pub is_folded: bool,
}

pub async fn get_local_releases_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<Vec<LocalReleaseRow>, sqlx::Error> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, String, Option<i32>, bool, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>, Option<String>, bool)> = sqlx::query_as(
        r#"SELECT lr.id, lr.title, lr.year, lr."forcedComplete", lr."releaseId", lr."matchStatus"::text,
                  lr.image, lr."imageUrl", lr."mediumPosition",
                  -- Any binding the box pass owns, not just a dissolved one. A disc it kept on the
                  -- box itself (no standalone equivalent) carries `mediumPosition` rather than
                  -- `boxReleaseId`, and needs the same protection: disc 1 of ABBA's box is tagged
                  -- with the standalone "Ring Ring" id, so the tag would drag it off the box.
                  CASE WHEN lr."boxReleaseId" IS NOT NULL OR lr."mediumPosition" IS NOT NULL
                       THEN (SELECT b."musicbrainzId" FROM "MusicBrainzRelease" b WHERE b.id = lr."releaseId")
                  END,
                  EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id) AS is_folded
           FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           WHERE lra."artistId" = $1
           ORDER BY lr.year, lr.title"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                title,
                year,
                forced_complete,
                release_id,
                match_status,
                image,
                image_url,
                medium_position,
                dissolved_bound_mb_id,
                is_folded,
            )| {
                LocalReleaseRow {
                    id,
                    title,
                    year,
                    forced_complete,
                    release_id,
                    match_status,
                    has_cover: image.is_some() || image_url.is_some(),
                    medium_position,
                    dissolved_bound_mb_id,
                    is_folded,
                }
            },
        )
        .collect())
}

// ---------------------------------------------------------------------------
// Get local tracks for a release
// ---------------------------------------------------------------------------

pub struct LocalTrackRow {
    pub id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub mb_release_id: Option<String>,
    pub mb_release_group_id: Option<String>,
    pub mb_album_artist_id: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    /// Seconds. Carried so `status::check_release_status`'s looser title rules can require the
    /// runtimes to agree - without it those rules would be matching on title evidence alone.
    pub duration: Option<i32>,
}

pub async fn get_local_tracks_for_release(
    pool: &PgPool,
    release_id: &str,
) -> Result<Vec<LocalTrackRow>, sqlx::Error> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<i32>, Option<String>, Option<String>, Option<String>, Option<i32>, Option<i32>, Option<i32>)> =
        sqlx::query_as(
            r#"SELECT id, title, artist, album, year, "mbReleaseId", "mbReleaseGroupId", "mbAlbumArtistId", "trackNumber", "discNumber", duration
               FROM "LocalReleaseTrack"
               WHERE "localReleaseId" = $1
               ORDER BY "discNumber", "trackNumber""#,
        )
        .bind(release_id)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                title,
                artist,
                album,
                year,
                mb_release_id,
                mb_release_group_id,
                mb_album_artist_id,
                track_number,
                disc_number,
                duration,
            )| {
                LocalTrackRow {
                    id,
                    title,
                    artist,
                    album,
                    year,
                    mb_release_id,
                    mb_release_group_id,
                    mb_album_artist_id,
                    track_number,
                    disc_number,
                    duration,
                }
            },
        )
        .collect())
}

pub async fn get_track_file_paths_for_release(
    pool: &PgPool,
    local_release_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "filePath" FROM "LocalReleaseTrack"
           WHERE "localReleaseId" = $1
           ORDER BY "discNumber", "trackNumber""#,
    )
    .bind(local_release_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

pub struct TrackMbIds {
    pub file_path: String,
    pub mb_release_id: String,
    pub mb_release_group_id: String,
    pub mb_track_id: Option<String>,
    pub mb_recording_id: Option<String>,
}

pub async fn get_tracks_with_mb_ids_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<Vec<TrackMbIds>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT lrt."filePath", mbr."musicbrainzId", mbr."releaseGroupId",
                  mbrt."musicbrainzId", mbrt."recordingId"
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           JOIN "MusicBrainzRelease" mbr ON lr."releaseId" = mbr.id
           LEFT JOIN "MusicBrainzReleaseTrack" mbrt ON lrt."mbTrackId" = mbrt.id
           WHERE lra."artistId" = $1
             AND lr."releaseId" IS NOT NULL"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(file_path, mb_release_id, mb_release_group_id, mb_track_id, mb_recording_id)| {
                TrackMbIds {
                    file_path,
                    mb_release_id,
                    mb_release_group_id,
                    mb_track_id,
                    mb_recording_id,
                }
            },
        )
        .collect())
}

pub async fn get_track_id_file_paths_for_release(
    pool: &PgPool,
    local_release_id: &str,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, "filePath" FROM "LocalReleaseTrack"
           WHERE "localReleaseId" = $1
           ORDER BY "discNumber", "trackNumber""#,
    )
    .bind(local_release_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Pick which artist a `--release <id>` targeted sync/validate runs under. A collab release ("A & B")
/// links multiple main artists via LocalReleaseArtist - without `artist_hint`, `ORDER BY a.name LIMIT 1`
/// picks whichever sorts first alphabetically, which may not be the artist the caller actually cares
/// about (e.g. the download's own artist during merge validation). When `artist_hint` names one of the
/// release's main artists, prefer it; otherwise fall back to the alphabetical pick.
pub async fn get_artist_for_release(
    pool: &PgPool,
    release_id: &str,
    artist_hint: Option<&str>,
) -> Result<Option<ArtistSyncRow>, sqlx::Error> {
    let row: Option<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT a.id, a.name, a.slug, a."musicbrainzId", a.image, a."imageUrl"
               FROM "Artist" a
               JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
               WHERE lra."localReleaseId" = $1
               ORDER BY CASE WHEN a.id = $2 THEN 0 ELSE 1 END, a.name
               LIMIT 1"#,
    )
    .bind(release_id)
    .bind(artist_hint)
    .fetch_optional(pool)
    .await?;

    Ok(
        row.map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
            id,
            name,
            slug,
            mb_id: mb_id.as_deref().and_then(sanitize_mb_id),
            has_image: image.is_some() || image_url.is_some(),
        }),
    )
}

// ---------------------------------------------------------------------------
// Run-hash resumability
// ---------------------------------------------------------------------------

pub async fn load_synced_artist_ids(
    pool: &PgPool,
    hash: &str,
) -> std::collections::HashSet<String> {
    let rows: Vec<(String,)> = sqlx::query_as(r#"SELECT id FROM "Artist" WHERE "syncHash" = $1"#)
        .bind(hash)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.into_iter().map(|(id,)| id).collect()
}

pub async fn stamp_sync_hash(pool: &PgPool, artist_id: &str, hash: &str) {
    sqlx::query(r#"UPDATE "Artist" SET "syncHash" = $1 WHERE id = $2"#)
        .bind(hash)
        .bind(artist_id)
        .execute(pool)
        .await
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `MusicBrainzRelease.title` is `VarChar(500)` and Postgres refuses an over-long value outright,
    /// so an enormous MusicBrainz title used to fail the whole insert with `value too long for type
    /// character varying(500)`. Hit live on Soulwax's "Most of the remixes we've made for other people
    /// over the years except for the one for Einstürzende Neubauten…", which runs past 600 characters.
    #[test]
    fn an_over_long_title_is_clamped_to_the_column_width() {
        let short = "Kind of Blue";
        assert_eq!(clamp_title(short), short, "a normal title is untouched");

        let long: String = "a".repeat(640);
        assert_eq!(clamp_title(&long).chars().count(), 500);

        let exactly: String = "b".repeat(500);
        assert_eq!(clamp_title(&exactly).chars().count(), 500);
    }

    /// Clamping counts characters, not bytes - the column does, and byte slicing would risk splitting
    /// a multi-byte character. MusicBrainz titles carry accents and curly quotes routinely.
    #[test]
    fn clamping_counts_characters_not_bytes() {
        let accented: String = "é".repeat(600);
        let clamped = clamp_title(&accented);
        assert_eq!(clamped.chars().count(), 500);
        assert_eq!(
            clamped.len(),
            1000,
            "600 chars is 1200 bytes; 500 chars is 1000"
        );
        assert!(clamped.chars().all(|c| c == 'é'), "no split character");
    }
}
