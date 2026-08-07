//! Per-release cover normalization: extract embedded art to `folder.jpg` at the release root.
//!
//! The candidate ordering itself lives in `common::images::release_cover_candidates` - the same
//! tree `index` resolves covers with - so the two can never drift. This module only decides
//! whether a release needs normalizing and how the result is encoded.

use std::fs;
use std::path::Path;

use common::images::{find_cover_file, load_cover_source, release_cover_candidates};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;

/// Longest side of a written cover. Big enough to stay useful as source art, small enough that a
/// per-release file costs little on disk and reads fast during an index run.
pub const MAX_DIM: u32 = 500;
pub const JPEG_QUALITY: u8 = 80;

pub const OUTPUT_NAME: &str = "folder.jpg";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// A cover/folder/front file already sits at the release root - nothing to do.
    AlreadyHasCover,
    /// A `folder.jpg` was written (or would have been, under --dry-run).
    Written,
    /// No cover file and no extractable embedded picture.
    NoArt,
    Failed(String),
}

/// Shrink to fit inside a `max_dim` square, preserving aspect ratio. Never upscales - art smaller
/// than the box is passed through untouched rather than blown up into a blurrier, larger file.
pub fn fit_within(img: DynamicImage, max_dim: u32) -> DynamicImage {
    if img.width() > max_dim || img.height() > max_dim {
        img.resize(max_dim, max_dim, FilterType::Lanczos3)
    } else {
        img
    }
}

/// Encode as JPEG and place at `dest`.
///
/// Written to a temp file and renamed into place: this writes into the user's music library, and an
/// interrupted run leaving a truncated `folder.jpg` behind would be silently treated as "already
/// has cover" by every later pass.
pub fn write_folder_jpg(img: &DynamicImage, dest: &Path) -> Result<(), String> {
    // JPEG has no alpha channel - a PNG source with transparency fails to encode without this.
    let rgb = DynamicImage::ImageRgb8(img.to_rgb8());

    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;

    let tmp = dest.with_extension("jpg.tmp");
    fs::write(&tmp, &buf).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dest).map_err(|e| {
        fs::remove_file(&tmp).ok();
        e.to_string()
    })
}

/// Normalize one release folder's cover.
pub fn process_release(release_dir: &Path, dry_run: bool) -> Outcome {
    if find_cover_file(release_dir).is_some() {
        return Outcome::AlreadyHasCover;
    }

    let Some(img) = release_cover_candidates(release_dir)
        .iter()
        .find_map(load_cover_source)
    else {
        return Outcome::NoArt;
    };

    if dry_run {
        return Outcome::Written;
    }

    match write_folder_jpg(&fit_within(img, MAX_DIM), &release_dir.join(OUTPUT_NAME)) {
        Ok(()) => Outcome::Written,
        Err(e) => Outcome::Failed(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "dmp_extract_meta_images_test_{}_{}_{}",
            std::process::id(),
            n,
            name
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn solid_rgb(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb([200, 40, 40])))
    }

    #[test]
    fn fit_within_shrinks_oversized_art_and_keeps_aspect() {
        let out = fit_within(solid_rgb(1400, 1000), MAX_DIM);
        assert_eq!(out.width(), 500);
        assert_eq!(out.height(), 357);
    }

    #[test]
    fn fit_within_never_upscales() {
        let out = fit_within(solid_rgb(300, 200), MAX_DIM);
        assert_eq!((out.width(), out.height()), (300, 200));
    }

    #[test]
    fn write_folder_jpg_produces_a_readable_jpeg_and_leaves_no_temp_file() {
        let dir = temp_dir("write");
        let dest = dir.join(OUTPUT_NAME);
        write_folder_jpg(&solid_rgb(320, 240), &dest).unwrap();

        let reread = image::open(&dest).unwrap();
        assert_eq!((reread.width(), reread.height()), (320, 240));
        assert!(!dir.join("folder.jpg.tmp").exists());
    }

    #[test]
    fn write_folder_jpg_handles_an_alpha_channel_source() {
        let dir = temp_dir("alpha");
        let dest = dir.join(OUTPUT_NAME);
        let rgba = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            64,
            64,
            image::Rgba([10, 220, 10, 128]),
        ));
        write_folder_jpg(&rgba, &dest).unwrap();
        assert!(image::open(&dest).is_ok());
    }

    #[test]
    fn a_release_with_a_root_cover_file_is_left_alone() {
        let dir = temp_dir("has_cover");
        solid_rgb(64, 64).save(dir.join("cover.png")).unwrap();

        assert_eq!(process_release(&dir, false), Outcome::AlreadyHasCover);
        assert!(!dir.join(OUTPUT_NAME).exists());
    }

    #[test]
    fn a_release_with_nothing_to_extract_reports_no_art() {
        let dir = temp_dir("no_art");
        fs::write(dir.join("notes.txt"), b"no audio, no art").unwrap();

        assert_eq!(process_release(&dir, false), Outcome::NoArt);
        assert!(!dir.join(OUTPUT_NAME).exists());
    }

    #[test]
    fn dry_run_reports_the_write_without_touching_disk() {
        let dir = temp_dir("dry_run");
        let sub = dir.join("CD1");
        fs::create_dir_all(&sub).unwrap();
        solid_rgb(64, 64).save(sub.join("cover.jpg")).unwrap();

        assert_eq!(process_release(&dir, true), Outcome::Written);
        assert!(!dir.join(OUTPUT_NAME).exists());
    }

    #[test]
    fn a_subfolder_cover_is_normalized_up_to_the_release_root() {
        let dir = temp_dir("subfolder");
        let sub = dir.join("CD1");
        fs::create_dir_all(&sub).unwrap();
        solid_rgb(900, 900).save(sub.join("cover.jpg")).unwrap();

        assert_eq!(process_release(&dir, false), Outcome::Written);
        let written = image::open(dir.join(OUTPUT_NAME)).unwrap();
        assert_eq!((written.width(), written.height()), (500, 500));
    }
}
