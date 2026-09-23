//! Single-field tag writers for the `--fix:*` modes. Each touches exactly one field; every other
//! frame on the file, including MusicBrainz ids, survives the write.

use std::path::Path;

use common::tags::TagFile;
use lofty::tag::ItemKey;

fn open_tagged(abs_path: &Path) -> Result<TagFile, String> {
    let tags = TagFile::open(abs_path)?;
    if !tags.had_tag() {
        return Err("No primary tag".to_string());
    }
    Ok(tags)
}

fn save(abs_path: &Path, tags: &TagFile) -> Result<(), String> {
    tags.save(abs_path)?;
    common::images::bump_dir_mtime(abs_path);
    Ok(())
}

/// Set `key` to a plain 4-digit year string, or remove it entirely when `year` is `None`.
pub fn apply_year(abs_path: &Path, key: ItemKey, year: Option<i32>) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    match year {
        Some(y) => tags.set(key, &y.to_string()),
        None => tags.remove(key),
    }
    save(abs_path, &tags)
}

/// Set the track `artist` (TPE1).
pub fn write_artist(abs_path: &Path, artist: &str) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    tags.set(ItemKey::TrackArtist, artist);
    save(abs_path, &tags)
}

/// Set `albumArtist` (TPE2).
pub fn write_album_artist(abs_path: &Path, album_artist: &str) -> Result<(), String> {
    let mut tags = open_tagged(abs_path)?;
    tags.set(ItemKey::AlbumArtist, album_artist);
    save(abs_path, &tags)
}
