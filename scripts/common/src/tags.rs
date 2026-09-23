use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::file::{AudioFile, FileType, TaggedFile};
use lofty::id3::v2::{
    AttachedPictureFrame, Frame, FrameId, Id3v2Tag, Id3v2Version, TextInformationFrame,
    TimestampFrame, UniqueFileIdentifierFrame,
};
use lofty::mpeg::MpegFile;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::items::Timestamp;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
use lofty::TextEncoding;
use std::borrow::Cow;
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
/// The release-track-into-recording-slot mixup this once corrected (`--repair-recording-tags`) was
/// undone once, library-wide, by a throwaway one-off script (see docs/specs/spec_tidy_script.md) - not by
/// code kept here. `write_mb_ids`'s own stale-recording self-heal below still corrects it going
/// forward on every normal sync.
#[derive(Debug, Default, Clone, Copy)]
pub struct MbTagIds<'a> {
    pub album_artist: Option<&'a str>,
    pub album: Option<&'a str>,
    pub release_group: Option<&'a str>,
    pub release_track: Option<&'a str>,
    pub recording: Option<&'a str>,
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
    let mut slots = TagFile::open(abs_path)?;

    let stale_recording = ids.release_track.is_some()
        && slots.get_mb(MbKey::Recording).as_deref() == ids.release_track;

    let mut needs_write = false;
    for (key, desired) in pairs {
        if let Some(val) = desired {
            let stale = stale_recording && key == MbKey::Recording;
            if force || stale || slots.get_mb(key).is_none() {
                slots.set_mb(key, val);
                needs_write = true;
            }
        }
    }

    if stale_recording && ids.recording.is_none() {
        slots.remove_mb(MbKey::Recording);
        needs_write = true;
    }

    if !needs_write {
        return Ok(false);
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

/// A file's tags, opened for surgical edits.
///
/// MPEG goes through lofty's concrete `Id3v2Tag`, never the generic `Tag`: lofty's generic-to-ID3v2
/// conversion has no frame mapping for several MusicBrainz ids and silently drops them on save, so a
/// generic resave of an MP3 erases frames this edit never touched. Every other format maps cleanly
/// through the generic `Tag`.
pub struct TagFile {
    inner: TagInner,
    had_tag: bool,
}

enum TagInner {
    Generic(TaggedFile),
    Id3 {
        tag: Id3v2Tag,
        version: Id3v2Version,
    },
}

impl TagFile {
    /// Opens with relaxed parsing: a file readable enough to be indexed is readable enough to edit,
    /// even with an unrelated malformed frame. A file without a tag block gets an empty one.
    pub fn open(abs_path: &Path) -> Result<Self, String> {
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
            let had_tag = mpeg.id3v2().is_some();
            let tag = mpeg.id3v2().cloned().unwrap_or_default();
            let version = tag.original_version();
            return Ok(TagFile {
                inner: TagInner::Id3 { tag, version },
                had_tag,
            });
        }

        let mut tagged = Probe::open(abs_path)
            .map_err(|e| format!("cannot open {}: {}", abs_path.display(), e))?
            .options(parse_opts)
            .read()
            .map_err(|e| format!("cannot read tags {}: {}", abs_path.display(), e))?;
        let had_tag = tagged.primary_tag().is_some();
        if !had_tag {
            let tag_type = tagged.primary_tag_type();
            tagged.insert_tag(Tag::new(tag_type));
        }
        Ok(TagFile {
            inner: TagInner::Generic(tagged),
            had_tag,
        })
    }

    /// Whether the file carried a tag block before it was opened.
    pub fn had_tag(&self) -> bool {
        self.had_tag
    }

    /// First value of `key`, trimmed; `None` when absent or blank.
    pub fn get(&self, key: ItemKey) -> Option<String> {
        self.values(key).into_iter().next()
    }

    /// Every value of `key` (multi-value frames split), trimmed and non-blank.
    pub fn values(&self, key: ItemKey) -> Vec<String> {
        let raw: Vec<String> = match &self.inner {
            TagInner::Generic(tagged) => tagged
                .primary_tag()
                .map(|t| t.get_strings(key).map(str::to_string).collect())
                .unwrap_or_default(),
            TagInner::Id3 { tag, .. } => match id3_slot(key) {
                Some(Id3Slot::Frame(id)) => {
                    let found = id3_frame_values(tag, id);
                    if found.is_empty() && id == DATE_FRAME {
                        id3_frame_values(tag, LEGACY_YEAR_FRAME)
                    } else {
                        found
                    }
                }
                Some(Id3Slot::UserText(desc)) => tag
                    .get_user_text(desc)
                    .map(|v| v.split('\0').map(str::to_string).collect())
                    .unwrap_or_default(),
                None => Vec::new(),
            },
        };
        raw.into_iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect()
    }

    pub fn set(&mut self, key: ItemKey, value: &str) {
        self.set_values(key, vec![value.to_string()]);
    }

    /// Replaces every value of `key` with `values` (empty removes the key).
    pub fn set_values(&mut self, key: ItemKey, values: Vec<String>) {
        if values.is_empty() {
            self.remove(key);
            return;
        }
        match &mut self.inner {
            TagInner::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.remove_key(key);
                    for value in values {
                        tag.push(TagItem::new(key, ItemValue::Text(value)));
                    }
                }
            }
            TagInner::Id3 { tag, version } => match id3_slot(key) {
                Some(Id3Slot::Frame(id)) => {
                    if id == DATE_FRAME {
                        let _ = tag.remove(&FrameId::Valid(Cow::Borrowed(LEGACY_YEAR_FRAME)));
                    }
                    let encoding = id3_encoding(*version);
                    let joined = values.join("\0");
                    let timestamp = (id == DATE_FRAME)
                        .then(|| joined.parse::<Timestamp>().ok())
                        .flatten();
                    tag.insert(match timestamp {
                        // Only a timestamp frame survives an ID3v2.3 save (split into TYER/TDAT).
                        Some(ts) => Frame::Timestamp(TimestampFrame::new(
                            FrameId::Valid(Cow::Borrowed(id)),
                            encoding,
                            ts,
                        )),
                        None => Frame::Text(TextInformationFrame::new(
                            FrameId::Valid(Cow::Borrowed(id)),
                            encoding,
                            joined,
                        )),
                    });
                }
                Some(Id3Slot::UserText(desc)) => {
                    tag.insert_user_text(desc.to_string(), values.join("\0"));
                }
                None => {}
            },
        }
    }

    pub fn remove(&mut self, key: ItemKey) {
        match &mut self.inner {
            TagInner::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.remove_key(key);
                }
            }
            TagInner::Id3 { tag, .. } => match id3_slot(key) {
                Some(Id3Slot::Frame(id)) => {
                    let _ = tag.remove(&FrameId::Valid(Cow::Borrowed(id)));
                    if id == DATE_FRAME {
                        let _ = tag.remove(&FrameId::Valid(Cow::Borrowed(LEGACY_YEAR_FRAME)));
                    }
                }
                Some(Id3Slot::UserText(desc)) => {
                    tag.remove_user_text(desc);
                }
                None => {}
            },
        }
    }

    pub fn has_picture(&self) -> bool {
        match &self.inner {
            TagInner::Generic(tagged) => tagged
                .primary_tag()
                .is_some_and(|t| !t.pictures().is_empty()),
            TagInner::Id3 { tag, .. } => tag
                .into_iter()
                .any(|frame| matches!(frame, Frame::Picture(_))),
        }
    }

    pub fn add_front_cover_jpeg(&mut self, jpeg_bytes: &[u8]) {
        let picture = Picture::unchecked(jpeg_bytes.to_vec())
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Jpeg)
            .build();
        match &mut self.inner {
            TagInner::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.push_picture(picture);
                }
            }
            TagInner::Id3 { tag, version } => {
                // Empty description: Latin-1 is valid in both ID3v2.3 and v2.4 and needs no BOM.
                let _ = version;
                tag.insert(Frame::Picture(AttachedPictureFrame::new(
                    TextEncoding::Latin1,
                    picture,
                )));
            }
        }
    }

    pub fn save(&self, abs_path: &Path) -> Result<(), String> {
        let result = match &self.inner {
            TagInner::Generic(tagged) => match tagged.primary_tag() {
                Some(tag) => tag.save_to_path(abs_path, WriteOptions::default()),
                None => return Ok(()),
            },
            TagInner::Id3 { tag, version } => tag.save_to_path(
                abs_path,
                WriteOptions::default().use_id3v23(*version == Id3v2Version::V3),
            ),
        };
        result.map_err(|e| format!("cannot write tags {}: {}", abs_path.display(), e))
    }

    fn get_mb(&self, key: MbKey) -> Option<String> {
        match &self.inner {
            TagInner::Generic(_) => self.get(key.item_key()),
            TagInner::Id3 { tag, .. } => {
                let value = match key.id3_description() {
                    Some(desc) => tag.get_user_text(desc).map(str::to_string),
                    None => tag.into_iter().find_map(|frame| match frame {
                        Frame::UniqueFileIdentifier(ufid)
                            if ufid.owner == MUSICBRAINZ_UFID_OWNER =>
                        {
                            Some(String::from_utf8_lossy(&ufid.identifier).into_owned())
                        }
                        _ => None,
                    }),
                };
                value
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            }
        }
    }

    fn set_mb(&mut self, key: MbKey, value: &str) {
        match &mut self.inner {
            TagInner::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.insert(TagItem::new(
                        key.item_key(),
                        ItemValue::Text(value.to_string()),
                    ));
                }
            }
            TagInner::Id3 { tag, .. } => match key.id3_description() {
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

    fn remove_mb(&mut self, key: MbKey) {
        match &mut self.inner {
            TagInner::Generic(tagged) => {
                if let Some(tag) = tagged.primary_tag_mut() {
                    tag.remove_key(key.item_key());
                }
            }
            TagInner::Id3 { tag, .. } => match key.id3_description() {
                Some(desc) => {
                    tag.remove_user_text(desc);
                }
                None => remove_musicbrainz_ufid(tag),
            },
        }
    }
}

/// The recording date; an ID3v2.3 tag stores the year as `TYER` instead.
const DATE_FRAME: &str = "TDRC";
const LEGACY_YEAR_FRAME: &str = "TYER";

fn id3_frame_values(tag: &Id3v2Tag, id: &str) -> Vec<String> {
    match tag.get(&FrameId::Valid(Cow::Borrowed(id))) {
        Some(Frame::Text(f)) => f.value.split('\0').map(str::to_string).collect(),
        Some(Frame::Timestamp(f)) => vec![f.timestamp.to_string()],
        _ => Vec::new(),
    }
}

/// ID3v2.3 has no UTF-8 encoding; a frame written with it is unreadable once saved as v2.3.
fn id3_encoding(version: Id3v2Version) -> TextEncoding {
    if version == Id3v2Version::V4 {
        TextEncoding::UTF8
    } else {
        TextEncoding::UTF16
    }
}

enum Id3Slot {
    Frame(&'static str),
    UserText(&'static str),
}

/// Where an `ItemKey` lives in an ID3v2 tag: a standard text frame, or a TXXX user-text frame.
/// A year has no frame of its own in ID3v2.4; it is the recording date.
fn id3_slot(key: ItemKey) -> Option<Id3Slot> {
    if key == ItemKey::Year {
        return Some(Id3Slot::Frame(DATE_FRAME));
    }
    let id = key.map_key(TagType::Id3v2)?;
    let is_frame_id = id.len() == 4
        && id
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    Some(if is_frame_id {
        Id3Slot::Frame(id)
    } else {
        Id3Slot::UserText(id)
    })
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
