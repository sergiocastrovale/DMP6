use super::*;
use chrono::Utc;
use sqlx::PgPool;

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
    #[derive(sqlx::FromRow)]
    struct TrackMbIdRow {
        #[sqlx(rename = "filePath")]
        file_path: String,
        mb_release_id: String,
        #[sqlx(rename = "releaseGroupId")]
        mb_release_group_id: String,
        mb_track_id: Option<String>,
        #[sqlx(rename = "recordingId")]
        mb_recording_id: Option<String>,
    }

    let rows: Vec<TrackMbIdRow> = sqlx::query_as(
        r#"SELECT lrt."filePath", mbr."musicbrainzId" AS mb_release_id, mbr."releaseGroupId",
                  mbrt."musicbrainzId" AS mb_track_id, mbrt."recordingId"
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
        .map(|r| TrackMbIds {
            file_path: r.file_path,
            mb_release_id: r.mb_release_id,
            mb_release_group_id: r.mb_release_group_id,
            mb_track_id: r.mb_track_id,
            mb_recording_id: r.mb_recording_id,
        })
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
    let row: Option<ArtistImageRow> = sqlx::query_as(
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

    Ok(row.map(ArtistSyncRow::from))
}
