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
    first_embedded_image(path)
        .map(|img| save_resized(img, output_path))
        .unwrap_or(false)
}

/// The first picture embedded in an audio file's tags that decodes as an image.
pub fn first_embedded_image(path: &Path) -> Option<image::DynamicImage> {
    use lofty::config::{ParseOptions, ParsingMode};
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let parse_opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);
    let tagged_file = Probe::open(path)
        .ok()
        .and_then(|p| p.options(parse_opts).read().ok())?;

    tagged_file
        .tags()
        .iter()
        .flat_map(|tag| tag.pictures())
        .find_map(|pic| image::load_from_memory(pic.data()).ok())
}

fn save_resized(img: image::DynamicImage, output_path: &Path) -> bool {
    let resized = img.resize_to_fill(200, 200, FilterType::Triangle);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    resized.save(output_path).is_ok()
}

// ---------------------------------------------------------------------------
// Release cover resolution: external file first, then embedded tag from the
// first audio file (or the first disc subfolder's), no scanning beyond that.
// ---------------------------------------------------------------------------

const COVER_FILE_STEMS: &[&str] = &["cover", "folder", "front"];
const COVER_FILE_EXTS: &[&str] = &["jpg", "jpeg", "png"];
const RELEASE_AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "opus", "aac", "ogg", "flac"];

/// The cover/folder/front image file in a directory, if one exists. Case-insensitive,
/// jpg/jpeg/png. Deterministic: `read_dir` order is not guaranteed, so matches are sorted.
pub fn find_cover_file(dir: &Path) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            if !p.is_file() {
                return false;
            }
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let ext = p
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            COVER_FILE_STEMS.contains(&stem.as_str()) && COVER_FILE_EXTS.contains(&ext.as_str())
        })
        .collect();
    matches.sort();
    matches.into_iter().next()
}

fn first_audio_file(dir: &Path) -> Option<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .map(|e| RELEASE_AUDIO_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    files.into_iter().next()
}

fn first_subfolder(dir: &Path) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs.into_iter().next()
}

/// Where a release's cover art can be read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverSource {
    /// A standalone image file (cover/folder/front).
    File(PathBuf),
    /// An audio file carrying an embedded picture tag.
    Embedded(PathBuf),
}

/// A release's cover candidates, best first: an external image file beats an embedded
/// tag, and the release root beats its first disc subfolder. Only the *first* audio
/// file and the *first* subfolder are ever considered - a release whose first file
/// carries no picture is left without art rather than scanning the rest of the folder.
pub fn release_cover_candidates(folder_path: &Path) -> Vec<CoverSource> {
    let mut candidates = Vec::new();

    if let Some(cover) = find_cover_file(folder_path) {
        candidates.push(CoverSource::File(cover));
    }
    if let Some(first) = first_audio_file(folder_path) {
        candidates.push(CoverSource::Embedded(first));
        return candidates;
    }
    // No audio directly in the release folder - a disc-split layout (CD1/CD2/...).
    if let Some(sub) = first_subfolder(folder_path) {
        if let Some(cover) = find_cover_file(&sub) {
            candidates.push(CoverSource::File(cover));
        }
        if let Some(first) = first_audio_file(&sub) {
            candidates.push(CoverSource::Embedded(first));
        }
    }
    candidates
}

/// Decode a cover candidate, or None when it is unreadable/undecodable.
pub fn load_cover_source(source: &CoverSource) -> Option<image::DynamicImage> {
    match source {
        CoverSource::File(path) => image::open(path).ok(),
        CoverSource::Embedded(path) => first_embedded_image(path),
    }
}

/// Resolve a release's cover to a 200x200 thumbnail at `output_path`, taking the first
/// candidate that decodes (see `release_cover_candidates` for the ordering).
pub fn resolve_release_cover(folder_path: &Path, output_path: &Path) -> bool {
    release_cover_candidates(folder_path)
        .iter()
        .find_map(load_cover_source)
        .map(|img| save_resized(img, output_path))
        .unwrap_or(false)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "dmp_images_test_{}_{}_{}",
            std::process::id(),
            n,
            name
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Encodes a solid-color square as JPEG bytes via the `image` crate (no hand-rolled
    /// binary fixtures).
    fn solid_jpeg(rgb: [u8; 3]) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb(rgb));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
            .unwrap();
        buf
    }

    fn write_cover_file(dir: &Path, filename: &str, rgb: [u8; 3]) {
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb(rgb));
        image::DynamicImage::ImageRgb8(img)
            .save(dir.join(filename))
            .unwrap();
    }

    /// Minimal FLAC: "fLaC" marker + STREAMINFO block, optionally followed by a PICTURE
    /// block (raw METADATA_BLOCK_PICTURE bytes) carrying `jpeg`. No real audio frames -
    /// lofty only needs valid block structure to read tags/pictures.
    fn write_minimal_flac(path: &Path, jpeg: Option<&[u8]>) {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"fLaC");

        bytes.push(if jpeg.is_none() { 0x80 } else { 0x00 }); // STREAMINFO (type 0)
        bytes.extend_from_slice(&34u32.to_be_bytes()[1..]); // 3-byte BE length
        bytes.extend(std::iter::repeat(0u8).take(34));

        if let Some(jpeg) = jpeg {
            let mime = b"image/jpeg";
            let mut content = Vec::new();
            content.extend_from_slice(&3u32.to_be_bytes()); // picture type: front cover
            content.extend_from_slice(&(mime.len() as u32).to_be_bytes());
            content.extend_from_slice(mime);
            content.extend_from_slice(&0u32.to_be_bytes()); // description length
            content.extend_from_slice(&4u32.to_be_bytes()); // width
            content.extend_from_slice(&4u32.to_be_bytes()); // height
            content.extend_from_slice(&24u32.to_be_bytes()); // color depth
            content.extend_from_slice(&0u32.to_be_bytes()); // indexed colors used
            content.extend_from_slice(&(jpeg.len() as u32).to_be_bytes());
            content.extend_from_slice(jpeg);

            bytes.push(0x80 | 6); // PICTURE (type 6), last block
            bytes.extend_from_slice(&(content.len() as u32).to_be_bytes()[1..]);
            bytes.extend_from_slice(&content);
        }

        fs::write(path, bytes).unwrap();
    }

    fn dominant_channel(path: &Path) -> usize {
        let img = image::open(path).unwrap().to_rgb8();
        let px = img.get_pixel(0, 0);
        let (mut idx, mut max) = (0usize, px[0]);
        for i in 1..3 {
            if px[i] > max {
                max = px[i];
                idx = i;
            }
        }
        idx
    }

    #[test]
    fn cover_file_wins_over_embedded_tag() {
        let dir = temp_dir("cover_wins");
        write_cover_file(&dir, "cover.jpg", [200, 0, 0]); // red
        // Present but unreadable as audio - proves it's never touched.
        fs::write(dir.join("track.flac"), b"not a real flac file").unwrap();

        let out = dir.join("out.jpg");
        assert!(resolve_release_cover(&dir, &out));
        assert_eq!(dominant_channel(&out), 0); // red channel
    }

    #[test]
    fn embedded_tag_uses_first_file_alphabetically() {
        let dir = temp_dir("first_file");
        write_minimal_flac(&dir.join("a.flac"), Some(&solid_jpeg([200, 0, 0]))); // red
        write_minimal_flac(&dir.join("b.flac"), Some(&solid_jpeg([0, 0, 200]))); // blue

        let out = dir.join("out.jpg");
        assert!(resolve_release_cover(&dir, &out));
        assert_eq!(dominant_channel(&out), 0); // a.flac's red, not b.flac's blue
    }

    #[test]
    fn subfolder_used_when_root_has_no_direct_audio_files() {
        let dir = temp_dir("subfolder");
        let cd1 = dir.join("CD1");
        let cd2 = dir.join("CD2");
        fs::create_dir_all(&cd1).unwrap();
        fs::create_dir_all(&cd2).unwrap();
        write_minimal_flac(&cd1.join("01.flac"), None); // no picture, no cover file
        write_minimal_flac(&cd2.join("01.flac"), Some(&solid_jpeg([0, 200, 0]))); // green

        let out = dir.join("out.jpg");
        // First subfolder (CD1) has neither a cover file nor a decodable picture -
        // must skip entirely, never falling through to CD2.
        assert!(!resolve_release_cover(&dir, &out));
    }

    #[test]
    fn subfolder_cover_file_used_when_present() {
        let dir = temp_dir("subfolder_cover");
        let cd1 = dir.join("CD1");
        fs::create_dir_all(&cd1).unwrap();
        write_cover_file(&cd1, "folder.png", [0, 0, 200]); // blue
        write_minimal_flac(&cd1.join("01.flac"), Some(&solid_jpeg([200, 0, 0]))); // red, ignored

        let out = dir.join("out.jpg");
        assert!(resolve_release_cover(&dir, &out));
        assert_eq!(dominant_channel(&out), 2); // blue channel, from folder.png not the flac
    }

    #[test]
    fn cover_file_is_case_insensitive_and_supports_png() {
        let dir = temp_dir("case_insensitive_png");
        write_cover_file(&dir, "Cover.PNG", [0, 200, 0]); // green

        let out = dir.join("out.jpg");
        assert!(resolve_release_cover(&dir, &out));
        assert_eq!(dominant_channel(&out), 1); // green channel
    }

    #[test]
    fn empty_folder_yields_no_cover() {
        let dir = temp_dir("empty");
        let out = dir.join("out.jpg");
        assert!(!resolve_release_cover(&dir, &out));
    }
}
