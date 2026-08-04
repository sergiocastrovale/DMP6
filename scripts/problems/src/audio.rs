//! Reading tags off disk, safely.
//!
//! Mirrors the extraction contract of `scripts/index/src/metadata.rs` - same `ParseOptions`, same
//! key normalization - so the values checked here are the values the indexer will actually see. A
//! scanner that read tags differently from the indexer would report defects that do not exist and
//! miss ones that do.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::ItemKey;

use crate::checks::year::RawDates;
use crate::id3raw;

/// Audio extensions worth opening. Matches the indexer's set.
pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "m4a", "opus", "ogg", "aac", "wma", "wav"];

/// Files whose tag parse panicked. Surfaced on the Summary sheet, because a nonzero count here
/// means the report is incomplete in a way the user should know about.
pub static PANIC_COUNT: AtomicU64 = AtomicU64::new(0);

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// The tag values this tool inspects.
#[derive(Debug, Default, Clone)]
pub struct TagSnapshot {
    /// `None` = the tag is absent. `Some("")` = present but empty. The indexer treats these
    /// differently, so collapsing them would lose the distinction that matters most.
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub dates: RawDates,
}

#[derive(Debug)]
pub enum ReadError {
    Open(String),
    Parse(String),
    Panicked,
}

impl ReadError {
    pub fn detail(&self) -> String {
        match self {
            Self::Open(e) => format!("cannot open: {e}"),
            Self::Parse(e) => format!("cannot parse tags: {e}"),
            Self::Panicked => "tag parser panicked".to_string(),
        }
    }
}

/// Install once from `main`.
///
/// At two million files, a handful of corrupt ones panicking inside lofty is expected rather than
/// exceptional. The default hook would print a full backtrace for each, which both destroys the
/// single-line progress display and buries the real output. `PROBLEMS_PANIC_TRACE=1` restores them
/// when a specific file needs investigating.
pub fn install_quiet_panic_hook() {
    let default_hook = std::panic::take_hook();
    let verbose = std::env::var_os("PROBLEMS_PANIC_TRACE").is_some();
    std::panic::set_hook(Box::new(move |info| {
        PANIC_COUNT.fetch_add(1, Ordering::Relaxed);
        if verbose {
            default_hook(info);
        }
    }));
}

/// Read one file's tags, surviving a parser panic.
///
/// The `catch_unwind` has to be *inside* the per-file closure: rayon catches a panic in a worker and
/// re-raises it on the thread that called `par_iter`, so a guard wrapping the parallel iterator
/// would still lose the entire batch. `AssertUnwindSafe` is sound because everything captured is
/// discarded on the unwind path - nothing partially-mutated escapes.
///
/// Note this is only effective when built with `--profile scan` (`panic = "unwind"`). Under the
/// default release profile's `panic = "abort"` the process dies instead; `main` warns about that at
/// startup.
pub fn read_tags_guarded(path: &Path) -> Result<TagSnapshot, ReadError> {
    catch_unwind(AssertUnwindSafe(|| read_tags(path))).unwrap_or(Err(ReadError::Panicked))
}

fn read_tags(path: &Path) -> Result<TagSnapshot, ReadError> {
    // Relaxed is what the indexer uses; it tolerates damaged frames instead of failing the file.
    // read_properties(false) skips audio-stream decoding, which we never look at - a meaningful
    // saving when multiplied by the whole library.
    let opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);
    let tagged = Probe::open(path)
        .map_err(|e| ReadError::Open(e.to_string()))?
        .options(opts)
        .read()
        .map_err(|e| ReadError::Parse(e.to_string()))?;

    let mut snap = TagSnapshot::default();

    for tag in tagged.tags() {
        // Typed accessors first - these are what the indexer reads for these four fields.
        if snap.title.is_none() {
            snap.title = tag.title().map(|c| c.into_owned());
        }
        if snap.artist.is_none() {
            snap.artist = tag.artist().map(|c| c.into_owned());
        }
        if snap.album.is_none() {
            snap.album = tag.album().map(|c| c.into_owned());
        }

        // Raw date strings, never `tag.date()`. See checks::year for why the parsed form is useless
        // to us, and id3raw for the MP3 case this still cannot reach.
        if snap.dates.recording.is_none() {
            snap.dates.recording = tag.get_string(ItemKey::RecordingDate).map(str::to_owned);
        }
        if snap.dates.year.is_none() {
            snap.dates.year = tag.get_string(ItemKey::Year).map(str::to_owned);
        }
        if snap.dates.release.is_none() {
            snap.dates.release = tag.get_string(ItemKey::ReleaseDate).map(str::to_owned);
        }
        if snap.dates.original.is_none() {
            snap.dates.original = tag
                .get_string(ItemKey::OriginalReleaseDate)
                .map(str::to_owned);
        }

        // albumArtist. `index/src/metadata.rs` reaches this by normalizing the Debug name of every
        // tag item, because the field arrives as ALBUMARTIST / ALBUM_ARTIST / "ALBUM ARTIST"
        // depending on container. lofty already folds all of those onto ItemKey::AlbumArtist
        // (TPE2 | ALBUMARTIST | ALBUM ARTIST), so asking for the key directly is equivalent - and
        // avoids two String allocations per tag item per file, which at library scale was the
        // single largest cost in this loop.
        if snap.album_artist.is_none() {
            snap.album_artist = tag.get_string(ItemKey::AlbumArtist).map(str::to_owned);
        }
    }

    // MP3 fallback: lofty silently drops malformed date frames, so a file that looks year-less here
    // may actually carry a corrupt year worth reporting. Only pay the second read when both date
    // fields came back empty AND this is an MP3 - i.e. exactly the population where a dropped frame
    // is a possible explanation.
    let looks_dateless = snap.dates.recording.is_none() && snap.dates.year.is_none();
    let is_mp3 = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp3"));
    if looks_dateless && is_mp3 {
        if let Ok(Some(raw)) = id3raw::read_id3v2_dates(path) {
            if snap.dates.recording.is_none() {
                snap.dates.recording = raw.tdrc.clone();
            }
            if snap.dates.year.is_none() {
                snap.dates.year = raw.tyer.clone().or(raw.tdrc);
            }
            if snap.dates.original.is_none() {
                snap.dates.original = raw.tdor.or(raw.tory);
            }
            if snap.dates.release.is_none() {
                snap.dates.release = raw.tdrl;
            }
        }
    }

    Ok(snap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn recognises_audio_extensions_case_insensitively() {
        assert!(is_audio_file(&PathBuf::from("a.mp3")));
        assert!(is_audio_file(&PathBuf::from("a.MP3")));
        assert!(is_audio_file(&PathBuf::from("a.FLAC")));
        assert!(!is_audio_file(&PathBuf::from("cover.jpg")));
        assert!(!is_audio_file(&PathBuf::from("notes.txt")));
        assert!(!is_audio_file(&PathBuf::from("noext")));
    }

    #[test]
    fn a_nonexistent_file_is_an_error_not_a_panic() {
        let err = read_tags_guarded(&PathBuf::from("/nonexistent/nope.mp3"));
        assert!(matches!(err, Err(ReadError::Open(_))));
    }

    #[test]
    fn a_non_audio_file_is_an_error_not_a_panic() {
        let path =
            std::env::temp_dir().join(format!("problems-notaudio-{}.mp3", std::process::id()));
        std::fs::write(&path, b"this is definitely not an mp3").expect("write");
        let got = read_tags_guarded(&path);
        assert!(got.is_err(), "garbage should not parse as audio");
        std::fs::remove_file(&path).ok();
    }
}
