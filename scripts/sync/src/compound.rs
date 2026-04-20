use chrono::Utc;
use common::artists::split_artists;
use common::config::Config;
use common::images::delete_artist_images;
use common::slug::make_slug;
use reqwest::Client;
use sqlx::PgPool;

use crate::db::{ensure_mb_release_artist_link, update_artist_sync_stats};
use crate::mb_api::RateLimiter;
use crate::mb_matching::find_mb_match_with_fallback;
use common::types::TrackMeta;

// ---------------------------------------------------------------------------
// Ensure a secondary (featured/split) artist exists and is synced
// ---------------------------------------------------------------------------

pub async fn sync_extra_artist(
    pool: &PgPool,
    client: &Client,
    limiter: &mut RateLimiter,
    artist_name: &str,
    release_id: &str,
    tracks: &[&TrackMeta],
) -> Result<Option<String>, String> {
    let slug = make_slug(artist_name);

    let existing: Option<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "musicbrainzId" FROM "Artist" WHERE slug = $1"#,
    )
    .bind(&slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let artist_db_id = if let Some((id, mb_id_opt)) = existing {
        // Already exists — ensure MB match if missing
        if mb_id_opt.is_none() {
            if let Ok(Some(m)) =
                find_mb_match_with_fallback(client, limiter, artist_name, tracks).await
            {
                update_artist_sync_stats(pool, &id, &m.id, Some(m.score.unwrap_or(100) as f64))
                    .await
                    .map_err(|e| format!("DB error: {}", e))?;
            }
        }
        id
    } else {
        // Create new artist
        let id = cuid2::create_id();
        let now = Utc::now().naive_utc();
        sqlx::query(
            r#"INSERT INTO "Artist" (id, name, slug, "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $4)
               ON CONFLICT (slug) DO NOTHING"#,
        )
        .bind(&id)
        .bind(artist_name)
        .bind(&slug)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

        // Fetch the id in case of conflict
        let (actual_id,): (String,) = sqlx::query_as(
            r#"SELECT id FROM "Artist" WHERE slug = $1"#,
        )
        .bind(&slug)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

        if let Ok(Some(m)) =
            find_mb_match_with_fallback(client, limiter, artist_name, tracks).await
        {
            update_artist_sync_stats(
                pool,
                &actual_id,
                &m.id,
                Some(m.score.unwrap_or(100) as f64),
            )
            .await
            .map_err(|e| format!("DB error: {}", e))?;
        }
        actual_id
    };

    // Link this artist to the MB release
    ensure_mb_release_artist_link(pool, release_id, &artist_db_id)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(Some(artist_db_id))
}

// ---------------------------------------------------------------------------
// Resolve compound TrackArtist entries for a set of local tracks
// ---------------------------------------------------------------------------

pub async fn resolve_compound_track_artists(
    pool: &PgPool,
    _client: &Client,
    _limiter: &mut RateLimiter,
    _artist_id: &str,
    _mb_release_id: &str,
    track_ids: &[String],
    tracks: &[&TrackMeta],
) -> Result<(), String> {
    for (track_id, track) in track_ids.iter().zip(tracks.iter()) {
        let raw_artist = match &track.artist {
            Some(a) => a.clone(),
            None => continue,
        };
        let (main_parts, feat_parts) = split_artists(&raw_artist);
        let parts: Vec<String> = main_parts.into_iter().chain(feat_parts).collect();
        if parts.len() <= 1 {
            continue;
        }
        for part in &parts {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let part_slug = make_slug(part);

            let existing: Option<(String,)> =
                sqlx::query_as(r#"SELECT id FROM "Artist" WHERE slug = $1"#)
                    .bind(&part_slug)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| format!("DB error: {}", e))?;

            let feat_artist_id = if let Some((id,)) = existing {
                id
            } else {
                let id = cuid2::create_id();
                let now = Utc::now().naive_utc();
                sqlx::query(
                    r#"INSERT INTO "Artist" (id, name, slug, "createdAt", "updatedAt")
                       VALUES ($1, $2, $3, $4, $4)
                       ON CONFLICT (slug) DO NOTHING"#,
                )
                .bind(&id)
                .bind(part)
                .bind(&part_slug)
                .bind(now)
                .execute(pool)
                .await
                .map_err(|e| format!("DB error: {}", e))?;

                let (actual_id,): (String,) =
                    sqlx::query_as(r#"SELECT id FROM "Artist" WHERE slug = $1"#)
                        .bind(&part_slug)
                        .fetch_one(pool)
                        .await
                        .map_err(|e| format!("DB error: {}", e))?;
                actual_id
            };

            // Insert FEATURED TrackArtist link
            let link_id = cuid2::create_id();
            let now = Utc::now().naive_utc();
            sqlx::query(
                r#"INSERT INTO "TrackArtist" (id, "trackId", "artistId", role, "createdAt")
                   VALUES ($1, $2, $3, 'FEATURED'::"TrackArtistRole", $4)
                   ON CONFLICT ("trackId", "artistId", role) DO NOTHING"#,
            )
            .bind(&link_id)
            .bind(track_id)
            .bind(&feat_artist_id)
            .bind(now)
            .execute(pool)
            .await
            .map_err(|e| format!("DB error: {}", e))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Clean ghost artists (no tracks, no local releases, no MB releases)
// ---------------------------------------------------------------------------

pub async fn cleanup_ghost_artists(pool: &PgPool, config: &Config) -> Result<u64, String> {
    let ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist"
           WHERE id NOT IN (
             SELECT DISTINCT "artistId" FROM "TrackArtist"
           )
           AND id NOT IN (
             SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
           )
           AND id NOT IN (
             SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
           )"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    if ids.is_empty() {
        return Ok(0);
    }

    let artist_ids: Vec<String> = ids.into_iter().map(|(id,)| id).collect();
    delete_artist_images(pool, config, &artist_ids).await;

    let result = sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
        .bind(&artist_ids)
        .execute(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(result.rows_affected())
}
