use chrono::{NaiveDateTime, Utc};
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
    // already fetched for allowlist::is_allowed, but not otherwise stored anywhere. [] = "original
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
    #[derive(sqlx::FromRow)]
    struct MbReleaseHeaderRow {
        title: String,
        #[sqlx(rename = "releaseDate")]
        release_date: Option<String>,
        status: String,
        disambiguation: Option<String>,
        packaging: Option<String>,
        country: Option<String>,
        #[sqlx(rename = "musicbrainzId")]
        musicbrainz_id: String,
    }

    let release_row: Option<MbReleaseHeaderRow> = sqlx::query_as(
        r#"SELECT title, "releaseDate", status::text, disambiguation, packaging, country, "musicbrainzId"
               FROM "MusicBrainzRelease" WHERE id = $1"#,
    )
    .bind(mb_release_db_id)
    .fetch_optional(pool)
    .await?;

    let MbReleaseHeaderRow {
        title,
        release_date,
        status,
        disambiguation,
        packaging,
        country,
        musicbrainz_id,
    } = match release_row {
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

    #[derive(sqlx::FromRow)]
    struct MbTrackHeaderRow {
        #[sqlx(rename = "musicbrainzId")]
        track_mb_id: Option<String>,
        position: Option<i32>,
        #[sqlx(rename = "discNumber")]
        disc_number: Option<i32>,
        #[sqlx(rename = "durationMs")]
        duration_ms: Option<i32>,
        title: String,
        #[sqlx(rename = "recordingId")]
        recording_id: Option<String>,
    }

    let track_rows: Vec<MbTrackHeaderRow> = sqlx::query_as(
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
        .filter_map(|r| {
            Some(MbTrack {
                id: r.track_mb_id?,
                title: r.title,
                position: r.position.map(|p| p as u32),
                length: r.duration_ms.map(|d| d as u64),
                disc_number: r.disc_number.map(|d| d as u32),
                recording: r.recording_id.map(|id| MbRecordingRef { id }),
            })
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `MusicBrainzRelease.title` is `VarChar(500)` and Postgres refuses an over-long value outright,
    /// so an enormous MusicBrainz title (some real releases have titles running well past 600
    /// characters) would fail the whole insert with `value too long for type character
    /// varying(500)` if left unclamped.
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
