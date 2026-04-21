use common::config::Config;
use common::images::delete_artist_images;
use sqlx::PgPool;

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
