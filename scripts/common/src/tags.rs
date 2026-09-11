use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::file::{AudioFile, FileType, TaggedFile};
use lofty::id3::v2::{Frame, Id3v2Tag, Id3v2Version, UniqueFileIdentifierFrame};
use lofty::mpeg::MpegFile;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use std::path::Path;
use std::time::SystemTime;

/// The MusicBrainz ids `write_mb_ids` embeds. Two per-track ids that are easy to confuse:
///
/// * `release_track` - the track's id *within one release* (`MbTrack.id`,
///   `MusicBrainzReleaseTrack.musicbrainzId`). Vorbis `MUSICBRAINZ_RELEASETRACKID`, ID3 TXXX
///   `MusicBrainz Release Track Id`, MP4 `MusicBrainz Release Track Id`.
/// * `recording` - the recording, shared by every release reprinting it
///   (`MusicBrainzReleaseTrack.recordingId`). Vorbis `MUSICBRAINZ_TRACKID`, ID3
///   `UFID:http://musicbrainz.org`, MP4 `MusicBrainz Track Id` - Picard's names, which say "track"
///   but mean the recording.
///
/// Writing the release-track id into the recording slot is the bug `--repair-recording-tags` undoes.
#[derive(Debug, Default, Clone, Copy)]
pub struct MbTagIds<'a> {
    pub album_artist: Option<&'a str>,
    pub album: Option<&'a str>,
    pub release_group: Option<&'a str>,
    pub release_track: Option<&'a str>,
    pub recording: Option<&'a str>,
}

/// What to do with a file's recording tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordingFix {
    Keep,
    Replace(String),
    Blank,
}

/// Decide a file's recording tag from what the DB knows about its current value.
///
/// `known` is the lookup of that value among MusicBrainz *release-track* ids: `None` when it is not
/// one (a genuine recording id, or something we know nothing about - left alone), `Some(Some(rec))`
/// when it is one and its recording is known, `Some(None)` when it is one but the recording is not
/// (yet) known. MBIDs are UUIDs, unique across entity types, so a match is proof the value was
/// written into the wrong slot - never a coincidence. An unknown recording blanks the tag: empty
/// beats wrong, and the next sync that learns the recording fills it.
pub fn plan_recording_fix(existing: Option<&str>, known: Option<&Option<String>>) -> RecordingFix {
    match (existing, known) {
        (Some(_), Some(Some(recording))) => RecordingFix::Replace(recording.clone()),
        (Some(_), Some(None)) => RecordingFix::Blank,
        _ => RecordingFix::Keep,
    }
}

/// Write embedded MusicBrainz IDs into a file's tags.
///
/// Doctrine (CLAUDE.md: "MusicBrainz IDs are definitive"): an EXISTING tag value is never silently
/// overwritten by default - a bad embedded ID from a past mis-match should require a deliberate
/// decision to correct, not get clobbered by a routine sync. Pass `force = true` (wired to sync's
/// `--overwrite`) to intentionally overwrite existing values, e.g. after fixing a bad match.
///
/// One exception: a recording tag holding this very track's release-track id is our own past bug,
/// not an embedded id to respect, so it is corrected (or blanked when the recording is unknown)
/// without `force`.
///
/// A file with no tag block at all gets one created so IDs can still be written - that's a genuine gap
/// (nothing to preserve), not a doctrine matter, unlike the overwrite behavior above.
pub fn write_mb_ids(abs_path: &Path, ids: &MbTagIds, force: bool) -> Result<bool, String> {
    let pairs = [
        (MbKey::AlbumArtist, ids.album_artist),
        (MbKey::Album, ids.album),
        (MbKey::ReleaseGroup, ids.release_group),
        (MbKey::ReleaseTrack, ids.release_track),
        (MbKey::Recording, ids.recording),
    ];
    if pairs.iter().all(|(_, v)| v.is_none()) {
        return Ok(false);
    }

    let original_mtime = mtime(abs_path)?;
    let mut slots = MbSlots::open(abs_path)?;

    let stale_recording =
        ids.release_track.is_some() && slots.get(MbKey::Recording).as_deref() == ids.release_track;

    let mut needs_write = false;
    for (key, desired) in pairs {
        if let Some(val) = desired {
            let stale = stale_recording && key == MbKey::Recording;
            if force || stale || slots.get(key).is_none() {
                slots.set(key, val);
                needs_write = true;
            }
        }
    }

    if stale_recording && ids.recording.is_none() {
        slots.remove(MbKey::Recording);
        needs_write = true;
    }

    if !needs_write {
        return Ok(false);
    }

    slots.save(abs_path)?;
    warn_if_mtime_not_restored(abs_path, original_mtime);
    Ok(true)
}

/// A file's `(recording, release-track)` ids. Empty values read as `None`.
pub fn read_track_mb_ids(abs_path: &Path) -> Result<(Option<String>, Option<String>), String> {
    let slots = MbSlots::open(abs_path)?;
    Ok((slots.get(MbKey::Recording), slots.get(MbKey::ReleaseTrack)))
}

/// Apply a `RecordingFix` to a file whose recording tag holds `release_track_id`. Also moves that
/// id into its proper slot when the release-track tag is empty. Every other tag item is untouched
/// and the file's mtime is kept, so index does not see a change. Returns whether the file was written.
pub fn apply_recording_fix(
    abs_path: &Path,
    fix: &RecordingFix,
    release_track_id: &str,
) -> Result<bool, String> {
    if *fix == RecordingFix::Keep {
        return Ok(false);
    }

    let original_mtime = mtime(abs_path)?;
    let mut slots = MbSlots::open(abs_path)?;

    match fix {
        RecordingFix::Replace(recording) => slots.set(MbKey::Recording, recording),
        _ => slots.remove(MbKey::Recording),
    }
    if slots.get(MbKey::ReleaseTrack).is_none() {
        slots.set(MbKey::ReleaseTrack, release_track_id);
    }

    slots.save(abs_path)?;
    warn_if_mtime_not_restored(abs_path, original_mtime);
    Ok(true)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MbKey {
    AlbumArtist,
    Album,
    ReleaseGroup,
    ReleaseTrack,
    Recording,
}

const MUSICBRAINZ_UFID_OWNER: &str = "http://musicbrainz.org";

impl MbKey {
    fn item_key(self) -> ItemKey {
        match self {
            MbKey::AlbumArtist => ItemKey::MusicBrainzReleaseArtistId,
            MbKey::Album => ItemKey::MusicBrainzReleaseId,
            MbKey::ReleaseGroup => ItemKey::MusicBrainzReleaseGroupId,
            MbKey::ReleaseTrack => ItemKey::MusicBrainzTrackId,
            MbKey::Recording => ItemKey::MusicBrainzRecordingId,
        }
    }

    /// Picard's TXXX description; `None` for the recording, which lives in a UFID frame.
    fn id3_description(self) -> Option<&'static str> {
        match self {
            MbKey::AlbumArtist => Some("MusicBrainz Album Artist Id"),
            MbKey::Album => Some("MusicBrainz Album Id"),
            MbKey::ReleaseGroup => Some("MusicBrainz Release Group Id"),
            MbKey::ReleaseTrack => Some("MusicBrainz Release Track Id"),
            MbKey::Recording => None,
        }
    }
}

/// A file's MusicBrainz id slots, read and written without disturbing anything else.
///
/// MPEG goes through lofty's concrete `Id3v2Tag`, never the generic `Tag`: in lofty 0.24 the generic
/// ID3v2 conversion has no frame mapping for `MusicBrainzReleaseId`/`ReleaseGroupId`/`TrackId` (they
/// are silently dropped on save - including values Picard had already written, so every generic
/// resave of an MP3 erased them) and `Tag::insert` rejects `MusicBrainzRecordingId` outright. Every
/// other format maps cleanly through the generic `Tag`.
enum MbSlots {
    Generic(TaggedFile),
    Id3 {
        tag: Id3v2Tag,
        version: Id3v2Version,
    },
}

impl MbSlots {
    fn open(abs_path: &Path) -> Result<Self, String> {
        let parse_opts = ParseOptions::new()
            .read_properties(false)
            .parsing_mode(ParsingMode::Relaxed);

        let file_type = Probe::open(abs_path)
            .map_err(|e| format!("cannot open {}: {}", abs_path.display(), e))?
            .guess_file_type()
            .map_err(|e| format!("cannot read {}: {}", abs_path.display(), e))?
            .file_type();

        if file_type == Some(FileType::Mpeg) {
            let mut file = std::fs::File::open(abs_path)
                .map_err(|e| format!("cannot open {}: {}", abs_path.display(), e))?;
            let mpeg = MpegFile::read_from(&mut file, parse_opts)
                .map_err(|e| format!("cannot read tags {}: {}", abs_path.display(), e))?;
            let tag = mpeg.id3v2().cloned().unwrap_or_default();
            let version = tag.original_version();
            return Ok(MbSlots::Id3 { tag, version });
        }

        let mut tagged = Probe::open(abs_path)
            .map_err(|e| format!("cannot open {}: {}", abs_path.display(), e))?
            .options(parse_opts)
            .read()
            .map_err(|e| format!("cannot read tags {}: {}", abs_path.display(), e))?;
        if tagged.primary_tag().is_none() {
            let tag_type = tagged.primary_tag_type();
            tagged.insert_tag(Tag::new(tag_type));
        }
        Ok(MbSlots::Generic(tagged))
    }

    fn get(&self, key: MbKey) -> Option<String> {
        let value = match self {
            MbSlots::Generic(tagged) => tagged
                .primary_tag()
                .and_then(|t| t.get_string(key.item_key()).map(str::to_string)),
            MbSlots::Id3 { tag, .. } => match key.id3_description() {
                Some(desc) => tag.get_user_text(desc).map(str::to_string),
                None => tag.into_iter().find_map(|frame| match frame {
                    Frame::UniqueFileIdentifier(ufid) if ufid.owner == MUSICBRAINZ_UFID_OWNER => {
                        Some(String::from_utf8_lossy(&ufid.identifier).into_owned())
                    }
                    _ => None,
                }),
            },
        };
        value
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    }

    fn set(&mut self, key: MbKey, value: &str) {
        match self {
            MbSlots::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.insert(TagItem::new(
                        key.item_key(),
                        ItemValue::Text(value.to_string()),
                    ));
                }
            }
            MbSlots::Id3 { tag, .. } => match key.id3_description() {
                Some(desc) => {
                    tag.insert_user_text(desc.to_string(), value.to_string());
                }
                None => {
                    remove_musicbrainz_ufid(tag);
                    tag.insert(Frame::UniqueFileIdentifier(UniqueFileIdentifierFrame::new(
                        MUSICBRAINZ_UFID_OWNER.to_string(),
                        value.as_bytes().to_vec(),
                    )));
                }
            },
        }
    }

    fn remove(&mut self, key: MbKey) {
        match self {
            MbSlots::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.remove_key(key.item_key());
                }
            }
            MbSlots::Id3 { tag, .. } => match key.id3_description() {
                Some(desc) => {
                    tag.remove_user_text(desc);
                }
                None => remove_musicbrainz_ufid(tag),
            },
        }
    }

    fn save(&self, abs_path: &Path) -> Result<(), String> {
        let result = match self {
            MbSlots::Generic(tagged) => match tagged.primary_tag() {
                Some(tag) => tag.save_to_path(abs_path, WriteOptions::default()),
                None => return Ok(()),
            },
            MbSlots::Id3 { tag, version } => tag.save_to_path(
                abs_path,
                WriteOptions::default().use_id3v23(*version == Id3v2Version::V3),
            ),
        };
        result.map_err(|e| format!("cannot write tags {}: {}", abs_path.display(), e))
    }
}

fn remove_musicbrainz_ufid(tag: &mut Id3v2Tag) {
    tag.retain(|frame| {
        !matches!(frame, Frame::UniqueFileIdentifier(ufid) if ufid.owner == MUSICBRAINZ_UFID_OWNER)
    });
}

fn mtime(abs_path: &Path) -> Result<SystemTime, String> {
    std::fs::metadata(abs_path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("cannot stat {}: {}", abs_path.display(), e))
}

/// Best-effort: the tag write already succeeded, so a failure here (e.g. `EPERM` - setting an
/// explicit mtime needs file ownership or `CAP_FOWNER`, unlike a plain content write, and a file
/// predating the current container user commonly lacks both) must not undo it or be reported as one.
/// It only costs an extra re-read next `--inspect`.
fn warn_if_mtime_not_restored(abs_path: &Path, original_mtime: SystemTime) {
    let times = std::fs::FileTimes::new().set_modified(original_mtime);
    let result = std::fs::File::options()
        .write(true)
        .open(abs_path)
        .and_then(|f| f.set_times(times));
    if let Err(e) = result {
        crate::error_log::log_warn(&format!(
            "cannot restore mtime {}: {}",
            abs_path.display(),
            e
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_file_with_no_recording_tag() {
        assert_eq!(plan_recording_fix(None, None), RecordingFix::Keep);
        assert_eq!(
            plan_recording_fix(None, Some(&Some("rec".into()))),
            RecordingFix::Keep
        );
    }

    #[test]
    fn keeps_a_value_that_is_not_a_release_track_id() {
        assert_eq!(plan_recording_fix(Some("rec"), None), RecordingFix::Keep);
    }

    #[test]
    fn replaces_a_release_track_id_with_its_known_recording() {
        assert_eq!(
            plan_recording_fix(Some("rt"), Some(&Some("rec".into()))),
            RecordingFix::Replace("rec".into())
        );
    }

    #[test]
    fn blanks_a_release_track_id_whose_recording_is_unknown() {
        assert_eq!(
            plan_recording_fix(Some("rt"), Some(&None)),
            RecordingFix::Blank
        );
    }
}
