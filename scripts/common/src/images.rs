use crate::config::Config;
use crate::s3::{create_s3_client, delete_from_s3, upload_to_s3};
use aws_sdk_s3::Client as S3Client;
use image::imageops::FilterType;
use md5::{Digest, Md5};
use sqlx::PgPool;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Cover art extraction (from embedded tags)
// ---------------------------------------------------------------------------

pub fn extract_cover_art(path: &Path, output_path: &Path) -> bool {
    use lofty::config::{ParseOptions, ParsingMode};
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let parse_opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);
    let tagged_file = match Probe::open(path)
        .ok()
        .and_then(|p| p.options(parse_opts).read().ok())
    {
        Some(f) => f,
        None => return false,
    };

    for tag in tagged_file.tags() {
        for pic in tag.pictures() {
            match image::load_from_memory(pic.data()) {
                Ok(img) => {
                    let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
                    if let Some(parent) = output_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    if resized.save(output_path).is_ok() {
                        return true;
                    }
                }
                Err(_) => continue,
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Cover art embedding (into audio file tags)
// ---------------------------------------------------------------------------

pub fn embed_cover_art(file_path: &Path, jpeg_bytes: &[u8]) -> Result<bool, String> {
    use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let parse_opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);

    let mut tagged = Probe::open(file_path)
        .map_err(|e| e.to_string())?
        .options(parse_opts)
        .read()
        .map_err(|e| e.to_string())?;

    let tag = match tagged.primary_tag_mut() {
        Some(t) => t,
        None => return Ok(false),
    };

    if !tag.pictures().is_empty() {
        return Ok(false);
    }

    let picture = Picture::unchecked(jpeg_bytes.to_vec())
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::Jpeg)
        .build();

    tag.push_picture(picture);
    tag.save_to_path(file_path, WriteOptions::default())
        .map_err(|e| e.to_string())?;

    bump_dir_mtime(file_path);
    Ok(true)
}

// ---------------------------------------------------------------------------
// Folder image fallbacks
// ---------------------------------------------------------------------------

pub fn use_folder_image(folder_path: &Path, output_path: &Path) -> Option<&'static str> {
    for name in &[
        "cover.jpg", "folder.jpg", "front.jpg",
        "Cover.jpg", "Folder.jpg", "Front.jpg",
    ] {
        let candidate = folder_path.join(name);
        if candidate.is_file() {
            if let Ok(img) = image::open(&candidate) {
                let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if resized.save(output_path).is_ok() {
                    return Some(name);
                }
            }
        }
    }
    None
}

pub fn use_artist_folder_image(artist_folder: &Path, output_path: &Path) -> bool {
    for name in &["folder.jpg", "cover.jpg", "Folder.jpg", "Cover.jpg"] {
        let candidate = artist_folder.join(name);
        if candidate.is_file() {
            if let Ok(img) = image::open(&candidate) {
                let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if resized.save(output_path).is_ok() {
                    return true;
                }
            }
        }
    }
    if let Ok(entries) = fs::read_dir(artist_folder) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if ext_lower == "jpg" || ext_lower == "jpeg" || ext_lower == "png" {
                        if let Ok(img) = image::open(&path) {
                            let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
                            if let Some(parent) = output_path.parent() {
                                fs::create_dir_all(parent).ok();
                            }
                            if resized.save(output_path).is_ok() {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Content hashing for deduplication
// ---------------------------------------------------------------------------

pub fn hash_image_file(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mut hasher = Md5::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

// ---------------------------------------------------------------------------
// S3 upload helper
// ---------------------------------------------------------------------------

pub async fn upload_release_image_to_s3(
    s3_client: &S3Client,
    bucket: &str,
    public_url: &str,
    pool: &PgPool,
    release_id: &str,
    image_key: &str,
    file_path: &PathBuf,
) -> bool {
    let s3_key = format!("releases/{}.jpg", image_key);
    match upload_to_s3(s3_client, bucket, &s3_key, file_path).await {
        Ok(_) => {
            let image_url = format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
            sqlx::query(
                r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
            )
            .bind(&image_url)
            .bind(release_id)
            .execute(pool)
            .await
            .ok();
            true
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Directory mtime bump (triggers index change detection)
// ---------------------------------------------------------------------------

pub fn bump_dir_mtime(file_path: &Path) {
    if let Some(dir) = file_path.parent() {
        let tmp = dir.join(".fix-touch");
        if fs::File::create(&tmp).is_ok() {
            let _ = fs::remove_file(&tmp);
        }
    }
}

// ---------------------------------------------------------------------------
// Image deletion helpers
// ---------------------------------------------------------------------------

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
            crate::error_log::log_warn(&format!("artist image lookup failed: {}", e));
            eprintln!("  Warning: artist image lookup failed: {}", e);
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    let artist_dir = PathBuf::from(&config.image_dir).join("artists");
    let use_local = config.use_local();
    let use_s3 = config.use_s3();

    let s3_ctx = if use_s3 {
        match (&config.storage_bucket, create_s3_client(config).await) {
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
            crate::error_log::log_warn(&format!("release image lookup failed: {}", e));
            eprintln!("  Warning: release image lookup failed: {}", e);
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    let release_dir = PathBuf::from(&config.image_dir).join("releases");
    let use_local = config.use_local();
    let use_s3 = config.use_s3();

    let s3_ctx = if use_s3 {
        match (&config.storage_bucket, create_s3_client(config).await) {
            (Some(bucket), Some(client)) => Some((client, bucket.clone())),
            _ => None,
        }
    } else {
        None
    };

    for (id, image, _image_url) in rows {
        if let Some(ref f) = image.filter(|s| !s.is_empty()) {
            let shared: (i64,) = sqlx::query_as(
                r#"SELECT COUNT(*) FROM "LocalRelease" WHERE image = $1 AND id != $2"#,
            )
            .bind(f)
            .bind(&id)
            .fetch_one(pool)
            .await
            .unwrap_or((0,));

            if shared.0 == 0 {
                if use_local {
                    let _ = fs::remove_file(release_dir.join(f));
                }
                if let Some((ref client, ref bucket)) = s3_ctx {
                    let key = format!("releases/{}", f);
                    delete_from_s3(client, bucket, &key).await;
                }
            }
        }
    }
}
