use aws_sdk_s3::Client as S3Client;
use common::s3::upload_to_s3;
use image::imageops::FilterType;
use sqlx::PgPool;
use std::fs;
use std::path::{Path, PathBuf};

/// Extract embedded cover art from an audio file, resize to 200×200, save to output_path.
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
        if let Some(pic) = tag.pictures().first() {
            match image::load_from_memory(pic.data()) {
                Ok(img) => {
                    let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
                    if let Some(parent) = output_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    return resized.save(output_path).is_ok();
                }
                Err(_) => return false,
            }
        }
    }
    false
}

/// Try named cover images (cover.jpg, folder.jpg, front.jpg) in a folder.
/// Resizes to 200×200, saves to output_path. Returns the filename found, or None.
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

/// Try a local image from the artist folder as artist image.
/// Checks named files first, then falls back to any jpg/png in the root.
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
    // Fallback: any jpg or png in the folder root
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

/// Upload a release image to S3 and record the URL in the DB. Returns true on success.
pub async fn upload_release_image_to_s3(
    s3_client: &S3Client,
    bucket: &str,
    public_url: &str,
    pool: &PgPool,
    release_id: &str,
    file_path: &PathBuf,
) -> bool {
    let s3_key = format!("releases/{}.jpg", release_id);
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
