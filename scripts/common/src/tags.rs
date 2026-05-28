use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagItem};
use std::path::Path;

pub fn write_mb_ids(
    abs_path: &Path,
    album_artist_id: Option<&str>,
    album_id: Option<&str>,
    release_group_id: Option<&str>,
    track_id: Option<&str>,
) -> Result<bool, String> {
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

    let tag = match tagged.primary_tag_mut() {
        Some(t) => t,
        None => return Ok(false),
    };

    let pairs: &[(ItemKey, Option<&str>)] = &[
        (ItemKey::MusicBrainzReleaseArtistId, album_artist_id),
        (ItemKey::MusicBrainzReleaseId, album_id),
        (ItemKey::MusicBrainzReleaseGroupId, release_group_id),
        (ItemKey::MusicBrainzRecordingId, track_id),
    ];

    let mut needs_write = false;
    for (key, desired) in pairs {
        if let Some(val) = desired {
            let existing = tag.get_string(key.clone());
            if existing != Some(val) {
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
