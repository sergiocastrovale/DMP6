//! Writes exactly one date-ish tag key, and only that key - targets an arbitrary `ItemKey` directly
//! instead of going through lofty's typed `set_date()`, which cannot address `ItemKey::Year`
//! (TYER/YEAR) on its own. Mirrors the save-to-path/mtime-bump pattern the `fix` binary's own
//! `tags.rs` uses for its writes.

use std::path::Path;

use lofty::config::{ParseOptions, ParsingMode};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagItem};

/// Set `key` to a plain 4-digit year string, or remove it entirely when `year` is `None`.
/// Every other tag item on the file is left untouched.
pub fn apply_year(abs_path: &Path, key: ItemKey, year: Option<i32>) -> Result<(), String> {
    // Matches `audio::read_tags_guarded`'s parsing mode. lofty's default (`BestAttempt`) eagerly
    // errors on a malformed legacy ID3v2.3 date segment (e.g. a corrupt TDAT day/month frame sitting
    // next to the TYER we're actually here to touch) - the same file this tool is trying to fix a
    // year on can fail to even *open* under the default mode. `Relaxed` tolerates it exactly like
    // the scanner already does, so a file that was readable enough to land in the spool is also
    // readable enough to write.
    let opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);
    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .options(opts)
        .read()
        .map_err(|e| e.to_string())?;

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

    tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
        .map_err(|e| e.to_string())?;

    common::images::bump_dir_mtime(abs_path);
    Ok(())
}
