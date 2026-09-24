use chrono::{NaiveDateTime, Utc};
use common::filters::sanitize_mb_id;
use sqlx::PgPool;

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
// Get artists pending sync (lastIndexedAt > lastSyncedAt OR never synced)
// ---------------------------------------------------------------------------

pub struct ArtistSyncRow {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub mb_id: Option<String>,
    pub has_image: bool,
}

/// Raw `Artist` columns `ArtistSyncRow` is always built from - `mb_id` still needs
/// `sanitize_mb_id`, and `has_image` is derived from two columns, so this stays a row shape rather
/// than `ArtistSyncRow` itself.
#[derive(sqlx::FromRow)]
pub struct ArtistImageRow {
    pub id: String,
    pub name: String,
    pub slug: String,
    #[sqlx(rename = "musicbrainzId")]
    pub mb_id: Option<String>,
    pub image: Option<String>,
    #[sqlx(rename = "imageUrl")]
    pub image_url: Option<String>,
}

impl From<ArtistImageRow> for ArtistSyncRow {
    fn from(r: ArtistImageRow) -> Self {
        ArtistSyncRow {
            id: r.id,
            name: r.name,
            slug: r.slug,
            mb_id: r.mb_id.as_deref().and_then(sanitize_mb_id),
            has_image: r.image.is_some() || r.image_url.is_some(),
        }
    }
}

pub async fn get_artists_pending_sync(pool: &PgPool) -> Result<Vec<ArtistSyncRow>, sqlx::Error> {
    let rows: Vec<ArtistImageRow> = sqlx::query_as(
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

    Ok(rows.into_iter().map(ArtistSyncRow::from).collect())
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
