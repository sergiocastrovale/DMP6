//! `--fix:artist-missing`: derive a missing `artist` tag from reliable signals already on disk.
//!
//! Two sources, tried in order, never MusicBrainz - there is nothing to verify an artist name
//! against without a title/album to search by, and `title` is frequently *also* empty on exactly
//! the files this targets:
//! 1. The same file's own `albumArtist`, if present and not machine junk.
//! 2. A strict majority `artist` value among the release folder's files (the whole folder, not just
//!    the defective ones - unlike `--fix:years`, trusting siblings here is the correct signal, not
//!    the risk: even a folder that mixes several sub-albums, per `FolderMultipleAlbums`, is very
//!    often still one artist's whole discography dumped together, and one mistagged track shouldn't
//!    be left broken when 200 others in the same folder agree).
//!
//! Anything that clears neither bar is an error - there is no "clear to null" for a field that is
//! already null.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use colored::*;
use lofty::config::{ParseOptions, ParsingMode};
use lofty::prelude::*;
use lofty::probe::Probe;

use crate::audio::{is_audio_file, read_tags_guarded};
use crate::checks::artist::{index_treats_as_special, is_unknown_artist, numeric_or_corrupted, unrecognised_various};
use crate::checks::text::{is_punctuation_only, is_whitespace_only};
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::{FixError, FixRunResult};

/// Rejects empty/whitespace/punctuation-only values and every "not a real artist" shape the
/// scanner itself already knows about (Various Artists markers, Unknown Artist, numeric/track-number
/// junk) - reused rather than re-invented so a candidate this fixer would accept is held to exactly
/// the same bar the detector uses to flag everything else.
fn is_usable_candidate(name: &str) -> bool {
    let t = name.trim();
    if t.is_empty() || is_whitespace_only(name) || is_punctuation_only(name) {
        return false;
    }
    if index_treats_as_special(t) || is_unknown_artist(t) {
        return false;
    }
    if numeric_or_corrupted(t).is_some() {
        return false;
    }
    if unrecognised_various(t).is_some() {
        return false;
    }
    true
}

pub async fn run(
    root: &Path,
    worklist: &BTreeMap<String, Vec<String>>,
    dry_run: bool,
) -> Result<FixRunResult, String> {
    let mut result = FixRunResult::default();

    for (rel_path, files) in worklist {
        let folder = root.join(rel_path);
        // Computed once per folder, not per file - a full folder walk is real I/O and every
        // defective file in the group shares the same answer.
        let majority = folder_majority_artist(&folder);
        match &majority {
            Some(a) => println!("  {} {} -> folder majority: {}", "→".bright_black(), rel_path, a),
            None => println!(
                "  {} {} -> no folder majority (falls back to each file's own albumArtist, if usable)",
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

    if snap
        .artist
        .as_deref()
        .is_some_and(|a| !a.trim().is_empty())
    {
        return Err(err(
            "artist tag no longer missing - tags changed since scan".to_string(),
        ));
    }

    let (artist, source) = if let Some(aa) = snap
        .album_artist
        .as_deref()
        .filter(|v| is_usable_candidate(v))
    {
        (aa.trim().to_string(), "albumArtist")
    } else if let Some(m) = folder_majority {
        (m.to_string(), "folder-majority")
    } else {
        return Err(err(
            "no reliable artist source - own albumArtist missing/junk and no folder majority"
                .to_string(),
        ));
    };

    if !dry_run {
        write_artist(abs_path, &artist).map_err(|e| err(format!("write failed: {e}")))?;
    }

    Ok(FixOutcome {
        path: rel_path.to_string(),
        file: file.to_string(),
        code: ReasonCode::ArtistMissing,
        action: "set".to_string(),
        field: "Artist".to_string(),
        old_value: String::new(),
        new_value: Some(artist),
        fix_kind: "artist-missing".to_string(),
        detail: serde_json::json!({ "source": source }),
        fixed_at: chrono::Local::now().to_rfc3339(),
    })
}

fn write_artist(abs_path: &Path, artist: &str) -> Result<(), String> {
    // See fix/tags.rs for why Relaxed matters: lofty's default mode can eagerly error opening a
    // file over an unrelated malformed frame elsewhere in the same tag.
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
    tag.set_artist(artist.to_string());

    tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
        .map_err(|e| e.to_string())?;

    common::images::bump_dir_mtime(abs_path);
    Ok(())
}

/// Strict majority `artist` among every audio file in the folder (recursing into disc subfolders),
/// among files whose artist is present and not junk. No majority ⇒ `None`, not a guess.
fn folder_majority_artist(folder: &Path) -> Option<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for entry in walkdir::WalkDir::new(folder)
        .follow_links(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if !is_audio_file(path) {
            continue;
        }
        if let Ok(snap) = read_tags_guarded(path) {
            if let Some(a) = snap.artist.as_deref() {
                if is_usable_candidate(a) {
                    *counts.entry(a.trim().to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let total: usize = counts.values().sum();
    if total == 0 {
        return None;
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .filter(|(_, c)| c * 2 > total)
        .map(|(a, _)| a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usable_candidate_rejects_junk() {
        assert!(!is_usable_candidate(""));
        assert!(!is_usable_candidate("   "));
        assert!(!is_usable_candidate("Various Artists"));
        assert!(!is_usable_candidate("Unknown Artist"));
        assert!(!is_usable_candidate("07"));
        assert!(!is_usable_candidate("V.A."));
        assert!(!is_usable_candidate("!!!!"));
    }

    #[test]
    fn usable_candidate_accepts_real_names() {
        assert!(is_usable_candidate("Hank Mobley"));
        assert!(is_usable_candidate("  Radiohead  "));
        assert!(is_usable_candidate("blink-182"));
        assert!(is_usable_candidate("The 1975"));
        // A real band whose name is a bare number stays accepted (mirrors numeric_or_corrupted).
        assert!(is_usable_candidate("311"));
    }
}
