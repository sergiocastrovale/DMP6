use chrono::{NaiveDateTime, Utc};
use slug::slugify;
use sqlx::PgPool;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// ReleaseType
// ---------------------------------------------------------------------------

pub async fn ensure_release_type(
    pool: &PgPool,
    name: &str,
) -> Result<String, sqlx::Error> {
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

pub async fn upsert_mb_release(
    pool: &PgPool,
    mb_release_group_id: &str,
    title: &str,
    year: Option<i32>,
    type_id: &str,
    status: &str,
    status_reason: Option<&str>,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "MusicBrainzRelease"
             (id, title, "typeId", year, "musicbrainzId", status, "statusReason", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6::\"ReleaseStatus\", $7, $8, $8)
           ON CONFLICT ("musicbrainzId") DO UPDATE SET
             title = EXCLUDED.title,
             "typeId" = EXCLUDED."typeId",
             year = COALESCE(EXCLUDED.year, "MusicBrainzRelease".year),
             status = EXCLUDED.status::\"ReleaseStatus\",
             "statusReason" = EXCLUDED."statusReason",
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(type_id)
    .bind(year)
    .bind(mb_release_group_id)
    .bind(status)
    .bind(status_reason)
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

pub async fn delete_mb_tracks_for_release(pool: &PgPool, release_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#)
        .bind(release_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub struct MbTrackRow {
    pub title: String,
    pub position: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_ms: Option<i32>,
    pub mb_id: Option<String>,
}

pub async fn batch_insert_mb_tracks(
    pool: &PgPool,
    release_id: &str,
    tracks: &[MbTrackRow],
) -> Result<Vec<(String, Option<String>)>, sqlx::Error> {
    // Returns Vec<(db_track_id, mb_track_id)>
    if tracks.is_empty() {
        return Ok(Vec::new());
    }
    let len = tracks.len();
    let ids: Vec<String> = (0..len).map(|_| cuid2::create_id()).collect();
    let titles: Vec<&str> = tracks.iter().map(|t| t.title.as_str()).collect();
    let positions: Vec<Option<i32>> = tracks.iter().map(|t| t.position).collect();
    let disc_numbers: Vec<Option<i32>> = tracks.iter().map(|t| t.disc_number).collect();
    let durations: Vec<Option<i32>> = tracks.iter().map(|t| t.duration_ms).collect();
    let mb_ids: Vec<Option<&str>> = tracks.iter().map(|t| t.mb_id.as_deref()).collect();
    let release_ids: Vec<&str> = vec![release_id; len];
    let now = Utc::now().naive_utc();
    let timestamps: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"INSERT INTO "MusicBrainzReleaseTrack"
             (id, title, position, "discNumber", "durationMs", "musicbrainzId", "releaseId", "createdAt", "updatedAt")
           SELECT * FROM UNNEST(
             $1::text[], $2::text[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[],
             $8::timestamp[], $9::timestamp[]
           )
           ON CONFLICT DO NOTHING
           RETURNING id, "musicbrainzId""#,
    )
    .bind(&ids)
    .bind(&titles)
    .bind(&positions)
    .bind(&disc_numbers)
    .bind(&durations)
    .bind(&mb_ids)
    .bind(&release_ids)
    .bind(&timestamps)
    .bind(&timestamps)
    .fetch_all(pool)
    .await?;

    Ok(rows)
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
    pool: &PgPool,
    local_release_id: &str,
    mb_release_id: &str,
    status: &str,
    status_reason: Option<&str>,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "releaseId" = $1,
               "matchStatus" = $2::\"ReleaseStatus\",
               "statusReason" = $3,
               "updatedAt" = $4
           WHERE id = $5"#,
    )
    .bind(mb_release_id)
    .bind(status)
    .bind(status_reason)
    .bind(now)
    .bind(local_release_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// LocalReleaseTrack → MusicBrainzReleaseTrack link
// ---------------------------------------------------------------------------

pub async fn link_local_tracks_to_mb(
    pool: &PgPool,
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
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Artist sync stats
// ---------------------------------------------------------------------------

pub async fn update_artist_sync_stats(
    pool: &PgPool,
    artist_id: &str,
    mb_id: &str,
    avg_score: Option<f64>,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "Artist"
           SET "musicbrainzId" = $1,
               "averageMatchScore" = $2,
               "lastSyncedAt" = $3,
               "updatedAt" = $3
           WHERE id = $4"#,
    )
    .bind(mb_id)
    .bind(avg_score)
    .bind(now)
    .bind(artist_id)
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

pub async fn get_artists_pending_sync(
    pool: &PgPool,
    from: Option<&str>,
    to: Option<&str>,
    only: Option<&str>,
) -> Result<Vec<ArtistSyncRow>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl"
               FROM "Artist"
               WHERE "lastIndexedAt" IS NOT NULL
                 AND ("lastSyncedAt" IS NULL OR "lastIndexedAt" > "lastSyncedAt")
               ORDER BY name"#,
        )
        .fetch_all(pool)
        .await?;

    let artists: Vec<ArtistSyncRow> = rows
        .into_iter()
        .map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
            id,
            name,
            slug,
            mb_id,
            has_image: image.is_some() || image_url.is_some(),
        })
        .collect();

    let filtered = artists
        .into_iter()
        .filter(|a| {
            if let Some(only) = only {
                return a.name.to_lowercase() == only.to_lowercase()
                    || a.slug == only;
            }
            let key = a.name.to_lowercase();
            let first = key.chars().next().unwrap_or('0');
            if let Some(from) = from {
                let from_c = from.to_lowercase().chars().next().unwrap_or('a');
                if first < from_c {
                    return false;
                }
            }
            if let Some(to) = to {
                let to_c = to.to_lowercase().chars().next().unwrap_or('z');
                if first > to_c {
                    return false;
                }
            }
            true
        })
        .collect();

    Ok(filtered)
}

// ---------------------------------------------------------------------------
// Get local releases for an artist (to sync against MB)
// ---------------------------------------------------------------------------

pub struct LocalReleaseRow {
    pub id: String,
    pub title: String,
    pub year: Option<i32>,
    pub group_key: String,
    pub forced_complete: bool,
}

pub async fn get_local_releases_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<Vec<LocalReleaseRow>, sqlx::Error> {
    let rows: Vec<(String, String, Option<i32>, String, bool)> = sqlx::query_as(
        r#"SELECT lr.id, lr.title, lr.year, lr."groupKey", lr."forcedComplete"
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
        .map(|(id, title, year, group_key, forced_complete)| LocalReleaseRow {
            id,
            title,
            year,
            group_key,
            forced_complete,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Get local tracks for a release
// ---------------------------------------------------------------------------

pub struct LocalTrackRow {
    pub id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub mb_album_id: Option<String>,
    pub mb_album_artist_id: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
}

pub async fn get_local_tracks_for_release(
    pool: &PgPool,
    release_id: &str,
) -> Result<Vec<LocalTrackRow>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>, Option<i32>)> =
        sqlx::query_as(
            r#"SELECT id, title, artist, "mbAlbumId", "mbAlbumArtistId", "trackNumber", "discNumber"
               FROM "LocalReleaseTrack"
               WHERE "localReleaseId" = $1
               ORDER BY "discNumber", "trackNumber""#,
        )
        .bind(release_id)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(id, title, artist, mb_album_id, mb_album_artist_id, track_number, disc_number)| {
            LocalTrackRow {
                id,
                title,
                artist,
                mb_album_id,
                mb_album_artist_id,
                track_number,
                disc_number,
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Mark local release as UNSYNCABLE
// ---------------------------------------------------------------------------

pub async fn mark_release_unsyncable(
    pool: &PgPool,
    local_release_id: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "matchStatus" = 'UNSYNCABLE'::"ReleaseStatus",
               "statusReason" = $1,
               "updatedAt" = $2
           WHERE id = $3"#,
    )
    .bind(reason)
    .bind(now)
    .bind(local_release_id)
    .execute(pool)
    .await?;
    Ok(())
}
