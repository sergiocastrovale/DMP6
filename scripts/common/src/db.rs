use chrono::Utc;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;

pub async fn create_pool(database_url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await
        .expect("Failed to connect to database")
}

pub async fn ensure_artist(pool: &PgPool, name: &str, related_only: bool) -> Result<String, sqlx::Error> {
    use crate::slug::make_slug;
    let artist_slug = make_slug(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "Artist" (id, name, slug, "relatedOnly", "totalPlayCount", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 0, 0, 0, $5, $5)
           ON CONFLICT (slug) DO UPDATE SET
             "relatedOnly" = CASE WHEN EXCLUDED."relatedOnly" = false THEN false ELSE "Artist"."relatedOnly" END,
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .bind(&artist_slug)
    .bind(related_only)
    .bind(now)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

pub async fn ensure_artist_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
    related_only: bool,
) -> Result<String, sqlx::Error> {
    use crate::slug::make_slug;
    let artist_slug = make_slug(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }
    if let Some(id) = cache.get(&artist_slug) {
        return Ok(id.clone());
    }
    let id = ensure_artist(pool, name, related_only).await?;
    if !id.is_empty() {
        cache.insert(artist_slug, id.clone());
    }
    Ok(id)
}
