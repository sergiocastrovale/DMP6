//! Small, surgical tag writers - each touches exactly one field and nothing else. Mirrors the
//! save-to-path/mtime-bump pattern the `fix` binary's own `tags.rs` uses for its writes.

use std::path::Path;

use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::TaggedFile;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagItem};

/// Opens with `ParsingMode::Relaxed`, matching `audio::read_tags_guarded`. lofty's default
/// (`BestAttempt`) eagerly errors on a malformed legacy ID3v2.3 date segment (e.g. a corrupt TDAT
/// day/month frame) even when the field actually being touched is unrelated - so the same file a fix
/// module is here to repair can fail to even *open* under the default mode. A file that was readable
/// enough to land in the spool is also readable enough to write.
fn open_relaxed(abs_path: &Path) -> Result<TaggedFile, String> {
    let opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);
    Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .options(opts)
        .read()
        .map_err(|e| e.to_string())
}

fn save(abs_path: &Path, tagged: TaggedFile) -> Result<(), String> {
    tagged
        .save_to_path(abs_path, lofty::config::WriteOptions::default())
        .map_err(|e| e.to_string())?;
    common::images::bump_dir_mtime(abs_path);
    Ok(())
}

/// Set `key` to a plain 4-digit year string, or remove it entirely when `year` is `None`.
/// Every other tag item on the file is left untouched.
pub fn apply_year(abs_path: &Path, key: ItemKey, year: Option<i32>) -> Result<(), String> {
    let mut tagged = open_relaxed(abs_path)?;
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "No primary tag".to_string())?;

    match year {
        Some(y) => {
            tag.insert(TagItem::new(key, ItemValue::Text(y.to_string())));
        }
        None => {
            tag.remove_key(key);
        }
    }

    save(abs_path, tagged)
}

/// Set the track `artist` (TPE1). Every other tag item is untouched.
pub fn write_artist(abs_path: &Path, artist: &str) -> Result<(), String> {
    let mut tagged = open_relaxed(abs_path)?;
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "No primary tag".to_string())?;
    tag.set_artist(artist.to_string());
    save(abs_path, tagged)
}

/// Set `albumArtist` (TPE2). Every other tag item, including `artist`, is untouched.
pub fn write_album_artist(abs_path: &Path, album_artist: &str) -> Result<(), String> {
    let mut tagged = open_relaxed(abs_path)?;
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "No primary tag".to_string())?;
    tag.insert(TagItem::new(
        ItemKey::AlbumArtist,
        ItemValue::Text(album_artist.to_string()),
    ));
    save(abs_path, tagged)
}
