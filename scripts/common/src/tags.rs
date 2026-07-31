use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use std::path::Path;

/// Write embedded MusicBrainz IDs into a file's tags.
///
/// Doctrine (CLAUDE.md: "MusicBrainz IDs are definitive"): an EXISTING tag value is never silently
/// overwritten by default - a bad embedded ID from a past mis-match should require a deliberate
/// decision to correct, not get clobbered by a routine sync. Pass `force = true` (wired to sync's
/// `--force-mb-tags` flag) to intentionally overwrite existing values, e.g. after fixing a bad match.
///
/// A file with no tag block at all gets one created so IDs can still be written - that's a genuine gap
/// (nothing to preserve), not a doctrine matter, unlike the overwrite behavior above.
pub fn write_mb_ids(
    abs_path: &Path,
    album_artist_id: Option<&str>,
    album_id: Option<&str>,
    release_group_id: Option<&str>,
    track_id: Option<&str>,
    force: bool,
) -> Result<bool, String> {
    if album_artist_id.is_none()
        && album_id.is_none()
        && release_group_id.is_none()
        && track_id.is_none()
    {
        return Ok(false);
    }

    let original_mtime = std::fs::metadata(abs_path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("cannot stat {}: {}", abs_path.display(), e))?;

    let parse_opts = ParseOptions::new()
        .read_properties(false)
        .parsing_mode(ParsingMode::Relaxed);

    let mut tagged = Probe::open(abs_path)
        .map_err(|e| format!("cannot open {}: {}", abs_path.display(), e))?
        .options(parse_opts)
        .read()
        .map_err(|e| format!("cannot read tags {}: {}", abs_path.display(), e))?;

    if tagged.primary_tag().is_none() {
        let tag_type = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .primary_tag_mut()
        .expect("primary tag was just inserted");

    let pairs: &[(ItemKey, Option<&str>)] = &[
        (ItemKey::MusicBrainzReleaseArtistId, album_artist_id),
        (ItemKey::MusicBrainzReleaseId, album_id),
        (ItemKey::MusicBrainzReleaseGroupId, release_group_id),
        (ItemKey::MusicBrainzRecordingId, track_id),
    ];

    let mut needs_write = false;
    for (key, desired) in pairs {
        if let Some(val) = desired {
            if force || tag.get_string(key.clone()).is_none() {
                tag.insert(TagItem::new(
                    key.clone(),
                    ItemValue::Text(val.to_string()),
                ));
                needs_write = true;
            }
        }
    }

    if !needs_write {
        return Ok(false);
    }

    tag.save_to_path(abs_path, WriteOptions::default())
        .map_err(|e| format!("cannot write tags {}: {}", abs_path.display(), e))?;

    let times = std::fs::FileTimes::new().set_modified(original_mtime);
    std::fs::File::options()
        .write(true)
        .open(abs_path)
        .and_then(|f| f.set_times(times))
        .map_err(|e| format!("cannot restore mtime {}: {}", abs_path.display(), e))?;

    Ok(true)
}
