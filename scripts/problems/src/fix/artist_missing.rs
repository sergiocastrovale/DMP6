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

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;

use crate::audio::read_tags_guarded;
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::candidates::{folder_majority, is_usable_candidate};
use super::tags::write_artist;
use super::{FixError, FixRunResult};

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
        let majority = folder_majority(&folder, |s| s.artist.as_deref());
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

