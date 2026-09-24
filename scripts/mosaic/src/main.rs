use chrono::Utc;
use clap::Parser;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImage, RgbImage};
use rand::seq::SliceRandom;
use rayon::prelude::*;
use serde_json::Value;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Parser)]
#[command(
    name = "mosaic",
    about = "Generate album cover mosaic from release images"
)]
struct Args {
    #[arg(long, default_value = "web/public/img/releases")]
    image_dir: String,

    #[arg(long, default_value = "web/public/img/labs")]
    output_dir: String,

    #[arg(long, default_value = "chronological")]
    mode: String,

    #[arg(long)]
    manifest: Option<String>,

    #[arg(long)]
    web: bool,
}

struct TileData {
    idx: usize,
    full: DynamicImage,
    preview: DynamicImage,
    warmth: f32,
}

fn rgb_to_warmth(r: u8, g: u8, b: u8) -> f32 {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;

    if delta < 0.001 {
        return 0.5;
    }

    let hue = if (max - rf).abs() < 0.001 {
        60.0 * (((gf - bf) / delta) % 6.0)
    } else if (max - gf).abs() < 0.001 {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };

    let hue = if hue < 0.0 { hue + 360.0 } else { hue };

    1.0 - ((hue - 30.0_f32).rem_euclid(360.0) / 360.0)
}

fn average_color(img: &DynamicImage) -> (u8, u8, u8) {
    let small = img.resize_exact(1, 1, FilterType::Triangle);
    let rgb = small.to_rgb8();
    let pixel = rgb.get_pixel(0, 0);
    (pixel[0], pixel[1], pixel[2])
}

fn diagonal_positions(cols: u32, rows: u32) -> Vec<(u32, u32)> {
    let mut positions = Vec::with_capacity((cols * rows) as usize);
    for d in 0..(cols + rows - 1) {
        for row in 0..rows {
            let col = d as i32 - row as i32;
            if col >= 0 && (col as u32) < cols {
                positions.push((row, col as u32));
            }
        }
    }
    positions
}

fn main() {
    let args = Args::parse();

    let manifest: Vec<Value> = args
        .manifest
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let scan_dir = || -> Vec<PathBuf> {
        fs::read_dir(&args.image_dir)
            .unwrap_or_else(|e| {
                eprintln!("Cannot read image directory '{}': {}", args.image_dir, e);
                std::process::exit(1);
            })
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                match path.extension()?.to_str()?.to_lowercase().as_str() {
                    "jpg" | "jpeg" => Some(path),
                    _ => None,
                }
            })
            .collect()
    };

    let mut paths: Vec<PathBuf> = if manifest.is_empty() {
        scan_dir()
    } else {
        let allowed: std::collections::HashSet<String> = manifest
            .iter()
            .filter_map(|e| e.get("file")?.as_str().map(String::from))
            .collect();

        let filtered: Vec<PathBuf> = allowed
            .iter()
            .map(|f| PathBuf::from(&args.image_dir).join(f))
            .filter(|p| p.exists())
            .collect();

        // A manifest names an explicit, curated set of files - falling back to scanning the whole
        // directory when none of them resolve would silently mosaic a completely different (and
        // usually much larger) set of images than the caller asked for, with no visible error.
        if filtered.is_empty() {
            eprintln!(
                "None of the {} manifest file(s) were found under '{}'",
                allowed.len(),
                args.image_dir
            );
            std::process::exit(1);
        }
        filtered
    };

    // Fail before spending minutes resizing/compositing thousands of images on an output path that
    // was never writable in the first place.
    fs::create_dir_all(&args.output_dir).unwrap_or_else(|e| {
        eprintln!(
            "Cannot create output directory '{}': {}",
            args.output_dir, e
        );
        std::process::exit(1);
    });

    if paths.is_empty() {
        eprintln!("No JPEG images found in '{}'", args.image_dir);
        std::process::exit(1);
    }

    if args.mode == "chronological" {
        let year_map: std::collections::HashMap<String, i64> = manifest
            .iter()
            .filter_map(|entry| {
                let file = entry.get("file")?.as_str()?.to_string();
                let year = entry.get("year")?.as_i64()?;
                Some((file, year))
            })
            .collect();

        paths.sort_by(|a, b| {
            let ya = a
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| year_map.get(n))
                .copied()
                .unwrap_or(9999);
            let yb = b
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| year_map.get(n))
                .copied()
                .unwrap_or(9999);
            ya.cmp(&yb)
        });
    } else if args.mode == "random" {
        paths.shuffle(&mut rand::thread_rng());
    }

    let count = paths.len();
    let cols = (count as f64).sqrt().ceil() as u32;
    let rows = ((count as f64) / (cols as f64)).ceil() as u32;

    let tile_size: u32 = match count {
        0..=5000 => 80,
        5001..=10000 => 60,
        10001..=20000 => 50,
        20001..=50000 => 40,
        _ => 30,
    };
    let preview_size: u32 = (tile_size * 3 / 8).max(10);

    if args.web {
        println!(
            "Found {} cover images, building {}x{} grid @ {}px (mode: {})",
            count, cols, rows, tile_size, args.mode
        );
    } else {
        eprintln!(
            "Found {} cover images, building {}x{} grid @ {}px (mode: {})",
            count, cols, rows, tile_size, args.mode
        );
    }

    let full_w = cols * tile_size;
    let full_h = rows * tile_size;
    let preview_w = cols * preview_size;
    let preview_h = rows * preview_size;

    let mut full_canvas = RgbImage::new(full_w, full_h);
    let mut preview_canvas = RgbImage::new(preview_w, preview_h);

    let processed = AtomicUsize::new(0);
    // At most ~100 PROGRESS lines over the whole run regardless of image count - a fixed stride like
    // "every 100" goes silent until the very end on a small mosaic (count < 100).
    let progress_stride = (count / 100).max(1);

    let mut tiles: Vec<TileData> = paths
        .par_iter()
        .enumerate()
        .filter_map(|(i, path)| {
            let img = image::open(path).ok()?;
            let full = img.resize_exact(tile_size, tile_size, FilterType::Triangle);
            let preview = img.resize_exact(preview_size, preview_size, FilterType::Triangle);
            let warmth = if args.mode == "gradient" {
                let (r, g, b) = average_color(&img);
                rgb_to_warmth(r, g, b)
            } else {
                0.0
            };

            let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
            if args.web {
                if done.is_multiple_of(progress_stride) || done == count {
                    println!(
                        "PROGRESS:{}",
                        serde_json::json!({"current": done, "total": count})
                    );
                }
            } else if done.is_multiple_of(100) || done == count {
                eprint!("\r  Processing: {}/{}", done, count);
            }

            Some(TileData {
                idx: i,
                full,
                preview,
                warmth,
            })
        })
        .collect();

    if !args.web {
        eprintln!();
    }

    if args.mode == "gradient" {
        tiles.sort_by(|a, b| {
            a.warmth
                .partial_cmp(&b.warmth)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let positions = diagonal_positions(cols, rows);

        for (tile_idx, tile) in tiles.iter().enumerate() {
            if tile_idx >= positions.len() {
                break;
            }
            let (row, col) = positions[tile_idx];
            full_canvas
                .copy_from(&tile.full.to_rgb8(), col * tile_size, row * tile_size)
                .ok();
            preview_canvas
                .copy_from(
                    &tile.preview.to_rgb8(),
                    col * preview_size,
                    row * preview_size,
                )
                .ok();
        }
    } else {
        tiles.sort_by_key(|t| t.idx);
        for tile in &tiles {
            let col = (tile.idx as u32) % cols;
            let row = (tile.idx as u32) / cols;
            full_canvas
                .copy_from(&tile.full.to_rgb8(), col * tile_size, row * tile_size)
                .ok();
            preview_canvas
                .copy_from(
                    &tile.preview.to_rgb8(),
                    col * preview_size,
                    row * preview_size,
                )
                .ok();
        }
    }

    // tiles.len(), not count: an image that failed to load is dropped by the filter_map above, and
    // the filename should say how many actually ended up in the mosaic, not how many were attempted.
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let full_name = format!("mosaic_{}_{}.jpg", timestamp, tiles.len());
    let preview_name = format!("mosaic_{}_{}_preview.jpg", timestamp, tiles.len());
    let full_path = PathBuf::from(&args.output_dir).join(&full_name);
    let preview_path = PathBuf::from(&args.output_dir).join(&preview_name);

    let full_quality: u8 = match count {
        0..=10000 => 80,
        10001..=20000 => 70,
        _ => 65,
    };
    let preview_quality: u8 = (full_quality - 15).max(50);

    {
        let file = fs::File::create(&full_path).expect("Failed to create full mosaic file");
        let writer = BufWriter::new(file);
        let mut encoder = JpegEncoder::new_with_quality(writer, full_quality);
        encoder
            .encode_image(&full_canvas)
            .expect("Failed to encode full mosaic");
    }

    {
        let file = fs::File::create(&preview_path).expect("Failed to create preview mosaic file");
        let writer = BufWriter::new(file);
        let mut encoder = JpegEncoder::new_with_quality(writer, preview_quality);
        encoder
            .encode_image(&preview_canvas)
            .expect("Failed to encode preview mosaic");
    }

    let full_size = fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
    let preview_size = fs::metadata(&preview_path).map(|m| m.len()).unwrap_or(0);

    if args.web {
        println!(
            "DONE:{}",
            serde_json::json!({
                "full": full_name,
                "preview": preview_name,
                "count": count,
                "cols": cols,
                "rows": rows,
            })
        );
    } else {
        eprintln!(
            "Created {} ({:.1} MB) and {} ({:.1} MB)",
            full_name,
            full_size as f64 / 1_048_576.0,
            preview_name,
            preview_size as f64 / 1_048_576.0,
        );
    }
}
