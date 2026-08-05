//! `--fix:albumartist-numeric-junk`: replace a machine-junk `albumArtist` (a track number, bare
//! year, or bitrate suffix that leaked into the field) with a reliable value already on disk.
//!
//! Same two-source, no-MusicBrainz shape as `--fix:artist-missing` (there is nothing to verify a
//! plain artist-name string against in isolation), mirrored rather than shared because the roles are
//! reversed: here `albumArtist` is the broken field and `artist` is the first place to look for a
//! replacement, not the other way round.
//! 1. The same file's own `artist`, if present and not machine junk.
//! 2. Failing that, a strict majority `albumArtist` value among the release folder's *other* files
//!    whose `albumArtist` is present and not junk.
//!
//! No candidate clears either bar ⇒ an error, file left untouched. There is no "clear to null" here
//! either - the field already holds *something*; leaving known-wrong data in place beats silently
//! blanking a field that at least currently has a value.

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;

use crate::audio::read_tags_guarded;
use crate::checks::artist::numeric_or_corrupted;
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::candidates::{folder_majority, is_usable_candidate};
use super::tags::write_album_artist;
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
        let majority = folder_majority(&folder, |s| s.album_artist.as_deref());
        match &majority {
            Some(a) => println!(
                "  {} {} -> folder majority albumArtist: {}",
                "→".bright_black(),
                rel_path,
                a
            ),
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
                        outcome
                            .detail
                            .get("source")
                            .and_then(|v| v.as_str())
                            .unwrap_or("?")
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

    let old_value = snap.album_artist.clone().unwrap_or_default();
    if numeric_or_corrupted(&old_value).is_none() {
        return Err(err(
            "albumArtist no longer looks like junk - tags changed since scan".to_string(),
        ));
    }

    let (album_artist, source) = if let Some(a) = snap.artist.as_deref().filter(|v| is_usable_candidate(v)) {
        (a.trim().to_string(), "artist")
    } else if let Some(m) = folder_majority {
        (m.to_string(), "folder-majority")
    } else {
        return Err(err(
            "no reliable albumArtist source - own artist missing/junk and no folder majority"
                .to_string(),
        ));
    };

    if !dry_run {
        write_album_artist(abs_path, &album_artist).map_err(|e| err(format!("write failed: {e}")))?;
    }

    Ok(FixOutcome {
        path: rel_path.to_string(),
        file: file.to_string(),
        code: ReasonCode::AlbumArtistNumericJunk,
        action: "set".to_string(),
        field: "AlbumArtist".to_string(),
        old_value,
        new_value: Some(album_artist),
        fix_kind: "albumartist-numeric-junk".to_string(),
        detail: serde_json::json!({ "source": source }),
        fixed_at: chrono::Local::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn process_file_errors_on_a_missing_file_without_touching_anything() {
        let result = process_file(
            "Some/Path",
            "nope.mp3",
            &PathBuf::from("/nonexistent/nope.mp3"),
            Some("Real Artist"),
            true,
        );
        assert!(result.is_err());
    }
}
