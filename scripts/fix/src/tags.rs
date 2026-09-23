use common::tags::TagFile;
use lofty::tag::ItemKey;
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

fn open_tagged(abs_path: &Path) -> Result<TagFile, String> {
    let tags = TagFile::open(abs_path)?;
    if !tags.had_tag() {
        return Err(format!("{} has no tag block", abs_path.display()));
    }
    Ok(tags)
}

pub fn write_album_artist(abs_path: &Path, value: &str) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    tags.set(ItemKey::AlbumArtist, value);
    tags.save(abs_path)?;
    common::images::bump_dir_mtime(abs_path);
    Ok(())
}

/// Renames `name_b` to `name_a` in the artist fields, including the multi-value credited-artist
/// frames that index's embedded pairing reads (a leftover value there would recreate `name_b`).
pub fn write_artist_tags(
    abs_path: &Path,
    artist: &str,
    album_artist: &str,
    name_b: &str,
    name_a: &str,
) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    tags.set(ItemKey::TrackArtist, artist);
    tags.set(ItemKey::AlbumArtist, album_artist);
    for key in [ItemKey::TrackArtists, ItemKey::AlbumArtists] {
        let values = tags.values(key);
        if !values.is_empty() {
            let renamed = values
                .iter()
                .map(|v| common::artists::replace_artist_word(v, name_b, name_a))
                .collect();
            tags.set_values(key, renamed);
        }
    }
    tags.save(abs_path)?;
    common::images::bump_dir_mtime(abs_path);
    Ok(())
}

const REVERTIBLE_FIELDS: [(&str, ItemKey); 4] = [
    ("artist", ItemKey::TrackArtist),
    ("albumArtist", ItemKey::AlbumArtist),
    ("album", ItemKey::AlbumTitle),
    ("year", ItemKey::RecordingDate),
];

/// The fields a fix may touch, as stored in `FixHistory.previousState`. An absent field is recorded
/// as `null` so a revert can remove what the fix added.
pub fn read_tags(abs_path: &Path) -> Result<serde_json::Value, String> {
    let tags = open_tagged(abs_path)?;
    let mut obj = serde_json::Map::new();
    for (name, key) in REVERTIBLE_FIELDS {
        obj.insert(name.into(), tags.get(key).map_or(json!(null), |v| json!(v)));
    }
    Ok(serde_json::Value::Object(obj))
}

/// Writes the fields present in `values`: a string sets it, a number sets a year, `null` removes it.
/// Fields not mentioned are left alone.
pub fn write_tags_from_json(abs_path: &Path, values: &serde_json::Value) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    for (name, key) in REVERTIBLE_FIELDS {
        match values.get(name) {
            Some(serde_json::Value::String(v)) => tags.set(key, v),
            Some(serde_json::Value::Number(n)) => tags.set(key, &n.to_string()),
            Some(serde_json::Value::Null) => tags.remove(key),
            _ => {}
        }
    }
    tags.save(abs_path)?;
    common::images::bump_dir_mtime(abs_path);
    Ok(())
}
