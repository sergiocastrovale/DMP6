//! Part of `--fix:albumartist`: fill or replace an `albumArtist` that is missing, or carries a
//! placeholder value the indexer does not special-case.
//!
//! Three trigger shapes, two resolutions:
//! - `ALBUMARTIST_MISSING` / `ALBUMARTIST_UNKNOWN_ARTIST` (`"Unknown Artist"` is exactly as useless
//!   as absent - the indexer has no special case for it, so it becomes one shared junk artist page):
//!   resolved the mirror of `artist_missing`'s two sources, roles reversed - the file's own `artist`
//!   tag first, then a strict majority `albumArtist` among the folder's other files.
//! - `ALBUMARTIST_UNRECOGNISED_VARIOUS` (`"v.a."`, `"OST"`, ...): these already unambiguously mean
//!   "various-artists compilation", just spelled in a form the indexer's exact-match check does not
//!   recognise. No sibling vote needed or wanted - a compilation's other tracks agreeing on the same
//!   marker would just be the same defect N times over. Rewritten straight to the canonical
//!   `"Various Artists"` string `common::artists::is_various_artists` (mirrored here as
//!   `checks::artist::index_treats_as_various`) actually recognises.

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;

use crate::audio::read_tags_guarded;
use crate::checks::artist::{is_unknown_artist, unrecognised_various};
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::candidates::{folder_majority, is_usable_candidate};
use super::tags::write_album_artist;
use super::{FixError, FixRunResult};

const CANONICAL_VARIOUS: &str = "Various Artists";

pub async fn run(
    root: &Path,
    worklist: &BTreeMap<String, Vec<String>>,
    dry_run: bool,
) -> Result<FixRunResult, String> {
    let mut result = FixRunResult::default();

    for (rel_path, files) in worklist {
        let folder = root.join(rel_path);
        // Computed once per folder, not per file - see artist_missing for why a whole-folder
        // majority (not just the defective files) is the right signal here.
        let majority = folder_majority(&folder, |s| s.album_artist.as_deref());
        match &majority {
            Some(a) => println!("  {} {} -> folder majority: {}", "→".bright_black(), rel_path, a),
            None => println!(
                "  {} {} -> no folder majority (falls back to each file's own artist, if usable)",
                "→".bright_black(),
                rel_path
            ),
        }

        for file in files {
            let abs_path = folder.join(file);
            match process_file(rel_path, file, &abs_path, majority.as_deref(), dry_run) {
                Ok(outcome) => {
                    println!(
                        "    {} {} -> \"{}\" (from {})",
                        "✓".green(),
                        file,
                        outcome.new_value.as_deref().unwrap_or(""),
                        outcome.detail.get("source").and_then(|v| v.as_str()).unwrap_or("?")
                    );
                    result.outcomes.push(outcome);
                }
                Err(error) => {
                    println!("    {} {}: {}", "!".bright_red(), file, error.message);
                    result.errors.push(error);
                }
            }
        }
    }

    Ok(result)
}

fn process_file(
    rel_path: &str,
    file: &str,
    abs_path: &Path,
    folder_majority: Option<&str>,
    dry_run: bool,
) -> Result<FixOutcome, FixError> {
    let err = |message: String| FixError {
        path: rel_path.to_string(),
        file: file.to_string(),
        message,
    };

    let snap =
        read_tags_guarded(abs_path).map_err(|e| err(format!("cannot read tags: {}", e.detail())))?;

    let current = snap.album_artist.as_deref();
    let old_value = current.unwrap_or("").to_string();

    let (code, new_value, source) = if current.is_none_or(|v| v.trim().is_empty()) {
        let (v, source) = derive(&snap, folder_majority)
            .ok_or_else(|| err("no reliable albumArtist source - own artist missing/junk and no folder majority".to_string()))?;
        (ReasonCode::AlbumArtistMissing, v, source)
    } else if is_unknown_artist(current.unwrap_or_default()) {
        let (v, source) = derive(&snap, folder_majority)
            .ok_or_else(|| err("no reliable albumArtist source - own artist missing/junk and no folder majority".to_string()))?;
        (ReasonCode::AlbumArtistUnknownArtist, v, source)
    } else if unrecognised_various(current.unwrap_or_default()).is_some() {
        (
            ReasonCode::AlbumArtistUnrecognisedVarious,
            CANONICAL_VARIOUS.to_string(),
            "canonical-various",
        )
    } else {
        return Err(err(
            "albumArtist no longer missing/placeholder - tags changed since scan".to_string(),
        ));
    };

    if !dry_run {
        write_album_artist(abs_path, &new_value).map_err(|e| err(format!("write failed: {e}")))?;
    }

    Ok(FixOutcome {
        path: rel_path.to_string(),
        file: file.to_string(),
        code,
        action: "set".to_string(),
        field: "AlbumArtist".to_string(),
        old_value,
        new_value: Some(new_value),
        fix_kind: "albumartist-missing".to_string(),
        detail: serde_json::json!({ "source": source }),
        fixed_at: chrono::Local::now().to_rfc3339(),
    })
}

/// The file's own `artist` tag if usable, else the folder-wide `albumArtist` majority.
fn derive(snap: &crate::audio::TagSnapshot, folder_majority: Option<&str>) -> Option<(String, &'static str)> {
    if let Some(a) = snap.artist.as_deref().filter(|v| is_usable_candidate(v)) {
        return Some((a.trim().to_string(), "artist"));
    }
    folder_majority.map(|m| (m.to_string(), "folder-majority"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_various_is_what_the_indexer_recognises() {
        assert!(crate::checks::artist::index_treats_as_various(CANONICAL_VARIOUS));
    }
}
