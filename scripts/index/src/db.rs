use chrono::{NaiveDateTime, Utc};
use common::types::TrackMeta;
use slug::slugify;
use sqlx::PgPool;
use std::collections::HashMap;

pub fn strip_disc_subfolder(folder_path: &str) -> String {
    if let Some(last_slash) = folder_path.rfind('/') {
        let last_segment = &folder_path[last_slash + 1..];
        let lower = last_segment.to_lowercase();
        let is_disc_folder = if let Some(rest) = lower.strip_prefix("cd") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else if let Some(rest) = lower.strip_prefix("disc") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else if let Some(rest) = lower.strip_prefix("disk") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else {
            false
        };
        if is_disc_folder {
            return folder_path[..last_slash].to_string();
        }
    }
    folder_path.to_string()
}

pub fn build_group_key(
    mb_release_id: Option<&str>,
    mb_release_group_id: Option<&str>,
    album_title: &str,
    year: Option<i32>,
    album_artist: &str,
    folder_path: &str,
) -> String {
    if let Some(id) = mb_release_id {
        if !id.is_empty() {
            return format!("mbr:{}:{}", id, folder_path);
        }
    }
    if let Some(id) = mb_release_group_id {
        if !id.is_empty() {
            return format!("mb:{}:{}", id, folder_path);
        }
    }
    let title_slug = slugify(album_title);
    let artist_slug = if album_artist.is_empty() {
        "unknown".to_string()
    } else {
        slugify(album_artist)
    };
    let yr = year.unwrap_or(0);
    format!("meta:{}:{}:{}:{}", title_slug, yr, artist_slug, folder_path)
}

pub async fn ensure_local_release(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    folder_path: &str,
    group_key: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "LocalRelease" (id, title, year, "matchStatus", "forcedComplete", "totalPlayCount", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath", "groupKey")
           VALUES ($1, $2, $3, 'UNKNOWN', false, 0, 0, 0, $4, $4, $5, $6)
           ON CONFLICT ("groupKey") DO UPDATE SET
             year = COALESCE(EXCLUDED.year, "LocalRelease".year),
             "updatedAt" = $4
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(year)
    .bind(now)
    .bind(folder_path)
    .bind(group_key)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

pub async fn ensure_local_release_cached(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    folder_path: &str,
    group_key: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(group_key) {
        return Ok(id.clone());
    }
    let id = ensure_local_release(pool, title, year, folder_path, group_key).await?;
    cache.insert(group_key.to_string(), id.clone());
    Ok(id)
}

/// Batch upsert tracks. Returns map of filePath → track id.
pub async fn batch_upsert_tracks(
    pool: &PgPool,
    tracks: &[(&TrackMeta, String)],
) -> Result<HashMap<String, String>, sqlx::Error> {
    if tracks.is_empty() {
        return Ok(HashMap::new());
    }

    let len = tracks.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut titles: Vec<Option<String>> = Vec::with_capacity(len);
    let mut artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut album_artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut albums: Vec<Option<String>> = Vec::with_capacity(len);
    let mut years: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut genres: Vec<Option<String>> = Vec::with_capacity(len);
    let mut durations: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut bitrates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut sample_rates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut file_paths: Vec<String> = Vec::with_capacity(len);
    let mut positions: Vec<Option<String>> = Vec::with_capacity(len);
    let mut track_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut disc_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut release_ids: Vec<String> = Vec::with_capacity(len);
    let mut file_sizes: Vec<i64> = Vec::with_capacity(len);
    let mut mtimes: Vec<NaiveDateTime> = Vec::with_capacity(len);
    let mut content_hashes: Vec<String> = Vec::with_capacity(len);
    let mut metadatas: Vec<serde_json::Value> = Vec::with_capacity(len);
    let mut mb_release_group_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let mut mb_release_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let mut mb_album_artist_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();

    for (track, release_id) in tracks {
        ids.push(cuid2::create_id());
        titles.push(track.title.clone());
        artists.push(track.artist.clone());
        album_artists.push(track.album_artist.clone());
        albums.push(track.album.clone());
        years.push(track.year);
        genres.push(track.genre.clone());
        durations.push(track.duration);
        bitrates.push(track.bitrate);
        sample_rates.push(track.sample_rate);
        file_paths.push(track.file_path.clone());
        positions.push(track.position.clone());
        track_numbers.push(track.track_number);
        disc_numbers.push(track.disc_number);
        release_ids.push(release_id.clone());
        file_sizes.push(track.file_size);
        mtimes.push(track.mtime);
        content_hashes.push(track.content_hash.clone());
        metadatas.push(serde_json::to_value(&track.metadata_json).unwrap_or(serde_json::Value::Null));
        mb_release_group_ids.push(track.mb_release_group_id.clone());
        mb_release_ids.push(track.mb_release_id.clone());
        mb_album_artist_ids.push(track.mb_album_artist_id.clone());
    }

    let play_counts: Vec<i32> = vec![0; len];
    let created: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "playCount", "createdAt", "updatedAt", "mbReleaseGroupId", "mbReleaseId", "mbAlbumArtistId")
           SELECT * FROM UNNEST(
               $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
               $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::int[], $14::int[],
               $15::text[], $16::bigint[], $17::timestamp[], $18::text[], $19::jsonb[],
               $20::int[], $21::timestamp[], $22::timestamp[], $23::text[], $24::text[], $25::text[]
           )
           ON CONFLICT ("filePath") DO UPDATE SET
             title = EXCLUDED.title, artist = EXCLUDED.artist, "albumArtist" = EXCLUDED."albumArtist",
             album = EXCLUDED.album, year = EXCLUDED.year, genre = EXCLUDED.genre,
             duration = EXCLUDED.duration, bitrate = EXCLUDED.bitrate, "sampleRate" = EXCLUDED."sampleRate",
             position = EXCLUDED.position, "trackNumber" = EXCLUDED."trackNumber", "discNumber" = EXCLUDED."discNumber",
             "localReleaseId" = EXCLUDED."localReleaseId", "fileSize" = EXCLUDED."fileSize",
             mtime = EXCLUDED.mtime, "contentHash" = EXCLUDED."contentHash", metadata = EXCLUDED.metadata,
             "mbReleaseGroupId" = EXCLUDED."mbReleaseGroupId", "mbReleaseId" = EXCLUDED."mbReleaseId",
             "mbAlbumArtistId" = EXCLUDED."mbAlbumArtistId",
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id, "filePath""#,
    )
    .bind(&ids)
    .bind(&titles)
    .bind(&artists)
    .bind(&album_artists)
    .bind(&albums)
    .bind(&years)
    .bind(&genres)
    .bind(&durations)
    .bind(&bitrates)
    .bind(&sample_rates)
    .bind(&file_paths)
    .bind(&positions)
    .bind(&track_numbers)
    .bind(&disc_numbers)
    .bind(&release_ids)
    .bind(&file_sizes)
    .bind(&mtimes)
    .bind(&content_hashes)
    .bind(&metadatas)
    .bind(&play_counts)
    .bind(&created)
    .bind(&created)
    .bind(&mb_release_group_ids)
    .bind(&mb_release_ids)
    .bind(&mb_album_artist_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, path)| (path, id)).collect())
}

pub async fn batch_ensure_track_related_artists(
    pool: &PgPool,
    links: &[(String, String)],
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }

    let len = links.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut track_ids: Vec<String> = Vec::with_capacity(len);
    let mut artist_ids: Vec<String> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();
    let mut timestamps: Vec<NaiveDateTime> = Vec::with_capacity(len);

    for (tid, aid) in links {
        ids.push(cuid2::create_id());
        track_ids.push(tid.clone());
        artist_ids.push(aid.clone());
        timestamps.push(now);
    }

    sqlx::query(
        r#"INSERT INTO "TrackRelatedArtist" (id, "trackId", "artistId", "createdAt")
           SELECT id, "trackId", "artistId", "createdAt"
           FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamp[])
             AS t(id, "trackId", "artistId", "createdAt")
           ON CONFLICT ("trackId", "artistId") DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&track_ids)
    .bind(&artist_ids)
    .bind(&timestamps)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn batch_ensure_local_release_artists(
    pool: &PgPool,
    links: &[(String, String)],
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }
    let now = Utc::now().naive_utc();
    let ids: Vec<String> = links.iter().map(|_| cuid2::create_id()).collect();
    let release_ids: Vec<String> = links.iter().map(|(r, _)| r.clone()).collect();
    let artist_ids: Vec<String> = links.iter().map(|(_, a)| a.clone()).collect();
    let timestamps: Vec<NaiveDateTime> = vec![now; links.len()];
    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamp[])
           ON CONFLICT ("localReleaseId", "artistId") DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&release_ids)
    .bind(&artist_ids)
    .bind(&timestamps)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn batch_update_mtimes(
    pool: &PgPool,
    updates: &[(NaiveDateTime, String)],
) -> Result<(), sqlx::Error> {
    if updates.is_empty() {
        return Ok(());
    }
    let mtimes: Vec<NaiveDateTime> = updates.iter().map(|(m, _)| *m).collect();
    let paths: Vec<String> = updates.iter().map(|(_, p)| p.clone()).collect();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET mtime = u.mtime, "updatedAt" = $3
           FROM UNNEST($1::timestamp[], $2::text[]) AS u(mtime, path)
           WHERE "LocalReleaseTrack"."filePath" = u.path"#,
    )
    .bind(&mtimes)
    .bind(&paths)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Update lastIndexedAt on Artist rows after indexing a folder.
pub async fn update_last_indexed_at(pool: &PgPool, artist_ids: &[String]) -> Result<(), sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"UPDATE "Artist" SET "lastIndexedAt" = NOW(), "updatedAt" = NOW()
           WHERE id = ANY($1::text[])"#,
    )
    .bind(artist_ids)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// FolderScan helpers
// ---------------------------------------------------------------------------

/// Upsert a folder's mtime into the FolderScan cache table.
pub async fn upsert_folder_scan(
    pool: &PgPool,
    folder_path: &str,
    mtime: NaiveDateTime,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "FolderScan" ("folderPath", mtime) VALUES ($1, $2)
           ON CONFLICT ("folderPath") DO UPDATE SET mtime = EXCLUDED.mtime"#,
    )
    .bind(folder_path)
    .bind(mtime)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn propagate_mb_artist_id(
    pool: &PgPool,
    artist_id: &str,
) -> Result<(), sqlx::Error> {
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#,
    )
    .bind(artist_id)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(ref mb_id),)) = existing {
        if !mb_id.is_empty() {
            return Ok(());
        }
    }

    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lrt."mbAlbumArtistId"
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
           WHERE lra."artistId" = $1
             AND lrt."mbAlbumArtistId" IS NOT NULL
             AND lrt."mbAlbumArtistId" != ''"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;

    if rows.len() == 1 {
        sqlx::query(
            r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
               WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
        )
        .bind(&rows[0].0)
        .bind(artist_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

