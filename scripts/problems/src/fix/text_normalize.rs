//! Part of `--fix:artist` and `--fix:albumartist`: `ARTIST_INVISIBLE_CHARS` /
//! `ALBUMARTIST_INVISIBLE_CHARS` / `ALBUMARTIST_UNTRIMMED` - the right name with the wrong bytes
//! around it.
//!
//! Unlike every other fix type, the correct value is derivable from the broken value itself: no
//! MusicBrainz, no sibling files, no folder majority. `checks::text::normalize_tag_text` is the
//! total, pure transform; this module's only job is deciding, per file and per field, whether that
//! transform is safe to apply at all.
//!
//! Refuses (error, file untouched) rather than writes when:
//! - the current value contains `U+FFFD` (the replacement character) - it means a *different*,
//!   earlier mis-decode already destroyed the real character, and no transform here can recover it;
//! - the normalized value fails `fix::candidates::is_usable_candidate` (empty, or empty after
//!   trimming) - a value that was made up entirely of invisible characters has nothing left to
//!   restore, and writing an empty tag is a worse defect than the one being fixed.

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;

use crate::audio::read_tags_guarded;
use crate::checks::text::{invisible_chars, is_untrimmed, normalize_tag_text};
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::candidates::is_usable_candidate;
use super::tags::{write_album_artist, write_artist};
use super::{FixError, FixRunResult};

pub async fn run(
    root: &Path,
    worklist: &BTreeMap<String, Vec<String>>,
    dry_run: bool,
) -> Result<FixRunResult, String> {
    let mut result = FixRunResult::default();

    for (rel_path, files) in worklist {
        let folder = root.join(rel_path);
        for file in files {
            let abs_path = folder.join(file);
            match process_file(rel_path, file, &abs_path, dry_run) {
                Ok(outcomes) if outcomes.is_empty() => {
                    println!(
                        "  {} {}/{}: tags changed since scan, nothing left to fix",
                        "-".yellow(),
                        rel_path,
                        file
                    );
                }
                Ok(outcomes) => {
                    for outcome in outcomes {
                        println!(
                            "  {} {}/{} [{}]: {:?} -> {:?}",
                            "✓".green(),
                            rel_path,
                            file,
                            outcome.code.code(),
                            outcome.old_value,
                            outcome.new_value.as_deref().unwrap_or("")
                        );
                        result.outcomes.push(outcome);
                    }
                }
                Err(error) => {
                    println!("  {} {}/{}: {}", "!".bright_red(), rel_path, file, error.message);
                    result.errors.push(error);
                }
            }
        }
    }

    Ok(result)
}

/// One field's fix, staged before anything is written - `field_key` distinguishes `artist` from
/// `album_artist` so the caller can call the right typed writer.
struct FieldFix {
    field_key: &'static str,
    old_value: String,
    new_value: String,
    codes: Vec<ReasonCode>,
}

fn process_file(
    rel_path: &str,
    file: &str,
    abs_path: &Path,
    dry_run: bool,
) -> Result<Vec<FixOutcome>, FixError> {
    let err = |message: String| FixError {
        path: rel_path.to_string(),
        file: file.to_string(),
        message,
    };

    let snap =
        read_tags_guarded(abs_path).map_err(|e| err(format!("cannot read tags: {}", e.detail())))?;

    let mut fixes = Vec::new();

    if let Some(artist) = snap.artist.as_deref() {
        if !invisible_chars(artist).is_empty() {
            fixes.push(stage_fix("artist", artist, vec![ReasonCode::ArtistInvisibleChars]));
        }
    }

    if let Some(album_artist) = snap.album_artist.as_deref() {
        let mut codes = Vec::new();
        if !invisible_chars(album_artist).is_empty() {
            codes.push(ReasonCode::AlbumArtistInvisibleChars);
        }
        if is_untrimmed(album_artist) {
            codes.push(ReasonCode::AlbumArtistUntrimmed);
        }
        if !codes.is_empty() {
            fixes.push(stage_fix("album_artist", album_artist, codes));
        }
    }

    // Nothing (left) to fix - tags changed since the scan, or the row's other field was the
    // defective one. Not an error: the file simply needs no touching.
    let fixes: Vec<FieldFix> = fixes.into_iter().flatten().collect();
    if fixes.is_empty() {
        return Ok(Vec::new());
    }

    // Any field failing its safety bar refuses the whole file, not just that field - a partial
    // write here would leave the file in a state the scan never actually described.
    for f in &fixes {
        if f.old_value.chars().any(|c| c == '\u{FFFD}') {
            return Err(err(format!(
                "{} contains U+FFFD (unrecoverable, from an earlier mis-decode) - refusing to guess",
                f.field_key
            )));
        }
        if !is_usable_candidate(&f.new_value) {
            return Err(err(format!(
                "{} is entirely invisible characters - nothing left after normalizing",
                f.field_key
            )));
        }
    }

    if !dry_run {
        for f in &fixes {
            let write_result = match f.field_key {
                "artist" => write_artist(abs_path, &f.new_value),
                _ => write_album_artist(abs_path, &f.new_value),
            };
            write_result.map_err(|e| err(format!("write failed: {e}")))?;
        }
    }

    let fixed_at = chrono::Local::now().to_rfc3339();
    let mut outcomes = Vec::new();
    for f in fixes {
        let field_label = if f.field_key == "artist" { "Artist" } else { "AlbumArtist" };
        for code in f.codes {
            outcomes.push(FixOutcome {
                path: rel_path.to_string(),
                file: file.to_string(),
                code,
                action: "set".to_string(),
                field: field_label.to_string(),
                old_value: f.old_value.clone(),
                new_value: Some(f.new_value.clone()),
                fix_kind: "text-normalize".to_string(),
                detail: serde_json::Value::Null,
                fixed_at: fixed_at.clone(),
            });
        }
    }
    Ok(outcomes)
}

/// `None` when the normalized value is unchanged - the field's defect no longer reproduces, not a
/// failure. `Some` even when `codes` is empty is never constructed; callers only stage a field once
/// at least one code is confirmed true of the current value.
fn stage_fix(field_key: &'static str, current: &str, codes: Vec<ReasonCode>) -> Option<FieldFix> {
    let normalized = normalize_tag_text(current);
    if normalized == current {
        return None;
    }
    Some(FieldFix {
        field_key,
        old_value: current.to_string(),
        new_value: normalized,
        codes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_fix_returns_none_when_normalizing_changes_nothing() {
        assert!(stage_fix("artist", "Radiohead", vec![ReasonCode::ArtistInvisibleChars]).is_none());
    }

    #[test]
    fn stage_fix_carries_old_and_new_value() {
        let f = stage_fix(
            "artist",
            "Jay\u{200B}-\u{200B}Z",
            vec![ReasonCode::ArtistInvisibleChars],
        )
        .expect("should stage");
        assert_eq!(f.old_value, "Jay\u{200B}-\u{200B}Z");
        assert_eq!(f.new_value, "Jay-Z");
    }

    #[test]
    fn stage_fix_handles_untrimmed() {
        let f = stage_fix("album_artist", "HEALTH ", vec![ReasonCode::AlbumArtistUntrimmed])
            .expect("should stage");
        assert_eq!(f.new_value, "HEALTH");
    }
}
