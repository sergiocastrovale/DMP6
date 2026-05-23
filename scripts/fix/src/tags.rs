use common::{config::Config, error_log};
use serde_json::json;
use std::path::{Path, PathBuf};

pub fn resolve_path(music_dir: &str, file_path: &str) -> PathBuf {
    if Path::new(file_path).is_absolute() {
        PathBuf::from(file_path)
    } else if !music_dir.is_empty() {
        Path::new(music_dir).join(file_path)
    } else {
        PathBuf::from(file_path)
    }
}

pub fn write_album_artist(abs_path: &Path, value: &str) -> Result<(), String> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::{ItemKey, ItemValue, TagItem};

    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    if let Some(tag) = tagged.primary_tag_mut() {
        tag.insert(TagItem::new(ItemKey::AlbumArtist, ItemValue::Text(value.to_string())));
        tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
            .map_err(|e| e.to_string())?;
    }

    bump_dir_mtime(abs_path);
    Ok(())
}

/// Deletes an artist image from local storage and/or S3 depending on config.
/// `image_file` is the bare filename (e.g. "the-rolling-stones.jpg") as stored in the DB.
pub async fn delete_artist_image(config: &Config, image_file: &str) {
    if config.use_local() {
        let local_path = Path::new(&config.image_dir)
            .join("artists")
            .join(image_file);
        if let Err(e) = std::fs::remove_file(&local_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                error_log::log_warn(&format!("failed to delete local image {}: {}", local_path.display(), e));
                eprintln!(
                    "  Warning: failed to delete local image {}: {}",
                    local_path.display(),
                    e
                );
            }
        }
    }

    if config.use_s3() {
        if let Some(bucket) = &config.storage_bucket {
            if let Some(client) = common::s3::create_s3_client(config).await {
                let key = format!("artists/{}", image_file);
                common::s3::delete_from_s3(&client, bucket, &key).await;
            }
        }
    }
}

pub fn write_artist_tags(abs_path: &Path, artist: &str, album_artist: &str) -> Result<(), String> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::{ItemKey, ItemValue, TagItem};

    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    if let Some(tag) = tagged.primary_tag_mut() {
        tag.set_artist(artist.to_string());
        tag.insert(TagItem::new(ItemKey::AlbumArtist, ItemValue::Text(album_artist.to_string())));
        tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
            .map_err(|e| e.to_string())?;
    }

    bump_dir_mtime(abs_path);
    Ok(())
}

pub fn read_tags(abs_path: &Path) -> Result<serde_json::Value, String> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::ItemKey;

    let tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag = tagged.primary_tag().ok_or_else(|| "No primary tag".to_string())?;

    let artist = tag.artist().map(|s| s.to_string());
    let album_artist = tag.get_string(ItemKey::AlbumArtist).map(|s| s.to_string());
    let album = tag.album().map(|s| s.to_string());
    let year = tag.date().map(|d| d.year as u32);

    let mut obj = serde_json::Map::new();
    if let Some(v) = artist {
        obj.insert("artist".into(), json!(v));
    }
    if let Some(v) = album_artist {
        obj.insert("albumArtist".into(), json!(v));
    }
    if let Some(v) = album {
        obj.insert("album".into(), json!(v));
    }
    if let Some(v) = year {
        obj.insert("year".into(), json!(v));
    }

    Ok(serde_json::Value::Object(obj))
}

pub fn write_tags_from_json(abs_path: &Path, values: &serde_json::Value) -> Result<(), String> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::{ItemKey, ItemValue, TagItem};

    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag = tagged.primary_tag_mut().ok_or_else(|| "No primary tag".to_string())?;

    if let Some(v) = values.get("albumArtist").and_then(|v| v.as_str()) {
        tag.insert(TagItem::new(ItemKey::AlbumArtist, ItemValue::Text(v.to_string())));
    }
    if let Some(v) = values.get("artist").and_then(|v| v.as_str()) {
        tag.set_artist(v.to_string());
    }
    if let Some(v) = values.get("album").and_then(|v| v.as_str()) {
        tag.set_album(v.to_string());
    }
    if let Some(v) = values.get("year").and_then(|v| v.as_u64()) {
        use lofty::tag::items::Timestamp;
        tag.set_date(Timestamp { year: v as u16, month: None, day: None, hour: None, minute: None, second: None });
    }

    tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
        .map_err(|e| e.to_string())?;

    bump_dir_mtime(abs_path);
    Ok(())
}

fn bump_dir_mtime(file_path: &Path) {
    common::images::bump_dir_mtime(file_path);
}
