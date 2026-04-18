use aws_sdk_s3::Client as S3Client;
use dmp_common::config::Config;
use dmp_common::filters::matches_filter;
use dmp_common::s3::delete_from_s3;
use sqlx::PgPool;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Delete all local data (Artist + LocalRelease + tracks + images) for artists
/// matching the from/to/only filter. Leaves MusicBrainz catalogue untouched.
/// Returns the number of artists deleted.
pub async fn nuke_local_artists(
    pool: &PgPool,
    from: &str,
    to: &str,
    only: &str,
    project_root: &str,
    s3_client: &Option<S3Client>,
    config: &Config,
) -> Result<u64, sqlx::Error> {
    let artist_img_dir = PathBuf::from(project_root).join("web/public/img/artists");
    let release_img_dir = PathBuf::from(project_root).join("web/public/img/releases");
    let use_local = config.use_local();
    let use_s3 = config.use_s3();

    let artists_with_names: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT id, name, image, "imageUrl" FROM "Artist""#,
    )
    .fetch_all(pool)
    .await?;

    let mut target_ids: Vec<String> = Vec::new();
    for (id, name, _, _) in &artists_with_names {
        if matches_filter(name, from, to, only) {
            target_ids.push(id.clone());
        }
    }

    if target_ids.is_empty() {
        return Ok(0);
    }

    // Find all releases linked to targeted artists
    let shared: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lra."localReleaseId" FROM "LocalReleaseArtist" lra
           WHERE lra."artistId" = ANY($1::text[])"#,
    )
    .bind(&target_ids)
    .fetch_all(pool)
    .await?;
    let release_ids: Vec<String> = shared.into_iter().map(|(id,)| id).collect();

    // Expand to all co-artists sharing those releases
    let co_artists: Vec<(String,)> = if !release_ids.is_empty() {
        sqlx::query_as(
            r#"SELECT DISTINCT lra."artistId" FROM "LocalReleaseArtist" lra
               WHERE lra."localReleaseId" = ANY($1::text[])"#,
        )
        .bind(&release_ids)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    let mut nuke_ids: HashSet<String> = target_ids.iter().cloned().collect();
    for (aid,) in &co_artists {
        nuke_ids.insert(aid.clone());
    }
    let nuke_list: Vec<String> = nuke_ids.into_iter().collect();
    let deleted = nuke_list.len() as u64;

    // Collect images to delete
    let mut artist_imgs: Vec<(Option<String>, String)> = Vec::new();
    let mut release_img_set: HashSet<(Option<String>, String)> = HashSet::new();

    for (artist_id, _name, image, image_url) in &artists_with_names {
        if !nuke_list.contains(artist_id) {
            continue;
        }

        let slug: Option<(String,)> = sqlx::query_as(
            r#"SELECT slug FROM "Artist" WHERE id = $1"#,
        )
        .bind(artist_id)
        .fetch_optional(pool)
        .await?;

        if image.is_some() || image_url.is_some() {
            if let Some((slug,)) = slug {
                artist_imgs.push((image.clone(), format!("artists/{}.jpg", slug)));
            }
        }

        if !release_ids.is_empty() {
            let imgs: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
                r#"SELECT DISTINCT lr.id, lr.image, lr."imageUrl" FROM "LocalRelease" lr
                   JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
                   WHERE lra."artistId" = $1
                     AND (lr.image IS NOT NULL OR lr."imageUrl" IS NOT NULL)"#,
            )
            .bind(artist_id)
            .fetch_all(pool)
            .await?;
            for (rid, img, img_url) in imgs {
                if img.is_some() || img_url.is_some() {
                    release_img_set.insert((img, format!("releases/{}.jpg", rid)));
                }
            }
        }
    }

    let total_images = artist_imgs.len() + release_img_set.len();
    if total_images > 0 {
        println!(
            "  Deleting {} image(s) ({} artist, {} release)...",
            total_images,
            artist_imgs.len(),
            release_img_set.len()
        );
    }

    let mut local_deleted = 0usize;
    let mut s3_deleted = 0usize;

    for (local_filename, s3_key) in &artist_imgs {
        if use_local {
            if let Some(f) = local_filename {
                if fs::remove_file(artist_img_dir.join(f)).is_ok() {
                    local_deleted += 1;
                }
            }
        }
        if use_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                delete_from_s3(s3, bucket, s3_key).await;
                s3_deleted += 1;
            }
        }
    }

    for (local_filename, s3_key) in &release_img_set {
        if use_local {
            if let Some(f) = local_filename {
                if fs::remove_file(release_img_dir.join(f)).is_ok() {
                    local_deleted += 1;
                }
            }
        }
        if use_s3 {
            if let (Some(ref s3), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                delete_from_s3(s3, bucket, s3_key).await;
                s3_deleted += 1;
            }
        }
    }

    if total_images > 0 {
        if use_local && use_s3 {
            println!("  {} Deleted {} local, {} S3", "✓", local_deleted, s3_deleted);
        } else if use_s3 {
            println!("  {} Deleted {} from S3", "✓", s3_deleted);
        } else {
            println!("  {} Deleted {} local", "✓", local_deleted);
        }
    }

    // Collect folder paths before deleting, so we can clear FolderScan entries.
    // This ensures --quick mode re-processes these folders on the next ./index run.
    let folder_paths: Vec<String> = if !release_ids.is_empty() {
        let rows: Vec<(Option<String>,)> = sqlx::query_as(
            r#"SELECT DISTINCT "folderPath" FROM "LocalRelease"
               WHERE id = ANY($1::text[]) AND "folderPath" IS NOT NULL"#,
        )
        .bind(&release_ids)
        .fetch_all(pool)
        .await?;
        rows.into_iter().filter_map(|(p,)| p).collect()
    } else {
        Vec::new()
    };

    // Delete releases (cascades to tracks and artist links via DB)
    if !release_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
            .bind(&release_ids)
            .execute(pool)
            .await?;
    }

    // Delete artists
    sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
        .bind(&nuke_list)
        .execute(pool)
        .await?;

    // Clean up orphaned releases (no remaining artist links)
    sqlx::query(
        r#"DELETE FROM "LocalRelease" WHERE id NOT IN (
               SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist"
           )"#,
    )
    .execute(pool)
    .await?;

    // Clear FolderScan entries so --quick mode re-processes these folders
    if !folder_paths.is_empty() {
        sqlx::query(r#"DELETE FROM "FolderScan" WHERE "folderPath" = ANY($1::text[])"#)
            .bind(&folder_paths)
            .execute(pool)
            .await?;
    }

    Ok(deleted)
}
