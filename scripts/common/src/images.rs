use crate::config::Config;
use crate::s3::{create_s3_client, delete_from_s3};
use sqlx::PgPool;
use std::fs;
use std::path::PathBuf;

/// Synchronously remove the artists' image files (local + S3) for the given IDs.
/// Must be called BEFORE the DB DELETE — it looks up `slug`, `image`, `imageUrl`
/// from the Artist rows and derives the S3 key as `artists/{slug}.jpg`.
pub async fn delete_artist_images(pool: &PgPool, config: &Config, artist_ids: &[String]) {
    if artist_ids.is_empty() {
        return;
    }

    let rows: Vec<(String, Option<String>, Option<String>)> = match sqlx::query_as(
        r#"SELECT slug, image, "imageUrl" FROM "Artist" WHERE id = ANY($1::text[])"#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  Warning: artist image lookup failed: {}", e);
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    let artist_dir = PathBuf::from(&config.project_root).join("web/public/img/artists");
    let use_local = config.use_local();
    let use_s3 = config.use_s3();

    let s3_ctx = if use_s3 {
        match (&config.s3_bucket, create_s3_client(config).await) {
            (Some(bucket), Some(client)) => Some((client, bucket.clone())),
            _ => None,
        }
    } else {
        None
    };

    for (slug, image, image_url) in rows {
        if use_local {
            if let Some(f) = image.as_ref().filter(|s| !s.is_empty()) {
                let _ = fs::remove_file(artist_dir.join(f));
            }
        }
        if let Some((ref client, ref bucket)) = s3_ctx {
            if image_url.as_ref().map_or(false, |s| !s.is_empty()) {
                let key = format!("artists/{}.jpg", slug);
                delete_from_s3(client, bucket, &key).await;
            }
        }
    }
}

/// Synchronously remove the releases' cover art (local + S3) for the given IDs.
/// Must be called BEFORE the DB DELETE — it looks up `image`, `imageUrl` and
/// derives the S3 key as `releases/{id}.jpg`.
pub async fn delete_release_images(pool: &PgPool, config: &Config, release_ids: &[String]) {
    if release_ids.is_empty() {
        return;
    }

    let rows: Vec<(String, Option<String>, Option<String>)> = match sqlx::query_as(
        r#"SELECT id, image, "imageUrl" FROM "LocalRelease" WHERE id = ANY($1::text[])"#,
    )
    .bind(release_ids)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  Warning: release image lookup failed: {}", e);
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    let release_dir = PathBuf::from(&config.project_root).join("web/public/img/releases");
    let use_local = config.use_local();
    let use_s3 = config.use_s3();

    let s3_ctx = if use_s3 {
        match (&config.s3_bucket, create_s3_client(config).await) {
            (Some(bucket), Some(client)) => Some((client, bucket.clone())),
            _ => None,
        }
    } else {
        None
    };

    for (id, image, image_url) in rows {
        if use_local {
            if let Some(f) = image.as_ref().filter(|s| !s.is_empty()) {
                let _ = fs::remove_file(release_dir.join(f));
            }
        }
        if let Some((ref client, ref bucket)) = s3_ctx {
            if image_url.as_ref().map_or(false, |s| !s.is_empty()) {
                let key = format!("releases/{}.jpg", id);
                delete_from_s3(client, bucket, &key).await;
            }
        }
    }
}
