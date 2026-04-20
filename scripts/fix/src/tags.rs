use common::config::Config;
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
        let local_path = Path::new(&config.project_root)
            .join("web/public/img/artists")
            .join(image_file);
        if let Err(e) = std::fs::remove_file(&local_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "  Warning: failed to delete local image {}: {}",
                    local_path.display(),
                    e
                );
            }
        }
    }

    if config.use_s3() {
        if let Some(bucket) = &config.s3_bucket {
            if let Some(client) = common::s3::create_s3_client(config).await {
                let key = format!("artists/{}", image_file);
                common::s3::delete_from_s3(&client, bucket, &key).await;
            }
        }
    }
}

fn bump_dir_mtime(file_path: &Path) {
    if let Some(dir) = file_path.parent() {
        let tmp = dir.join(".fix-touch");
        if std::fs::File::create(&tmp).is_ok() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
}
