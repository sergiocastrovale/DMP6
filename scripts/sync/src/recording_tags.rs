//! `--repair-recording-tags`: undo release-track ids written into the recording-id tag slot.
//!
//! `common::tags::write_mb_ids` used to write each track's MusicBrainz *release-track* id into
//! `ItemKey::MusicBrainzRecordingId` - Picard's `MUSICBRAINZ_TRACKID` / ID3 UFID, which holds the
//! *recording*. A normal sync filled it wherever the tag was empty, and `--overwrite` replaced correct
//! Picard values with it. This pass finds every owned file whose recording tag equals a known
//! release-track id (MBIDs are unique across entity types, so that is proof, never a coincidence) and
//! rewrites it to that track's recording id, or blanks it when the recording is not known yet. No
//! other value is touched, and mtimes are kept. No MusicBrainz calls.

use crate::db::{get_owned_track_paths_for_artist, get_recordings_for_release_track_ids};
use common::filters::matches_filter;
use common::progress::Reporter;
use common::tags::{apply_recording_fix, plan_recording_fix, read_track_mb_ids, RecordingFix};
use sqlx::PgPool;
use std::collections::HashSet;
use std::path::Path;

pub struct Filter<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub only: &'a str,
    pub exact: bool,
}

#[derive(Default)]
pub struct Summary {
    pub artists: usize,
    pub scanned: u32,
    pub missing: u32,
    pub replaced: u32,
    pub blanked: u32,
    pub failed: u32,
}

pub async fn run(
    pool: &PgPool,
    reporter: &Reporter,
    music_dir: &str,
    filter: &Filter<'_>,
    dry_run: bool,
    verbose: bool,
) -> Result<Summary, sqlx::Error> {
    let artists: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT id, name FROM "Artist" ORDER BY name"#)
            .fetch_all(pool)
            .await?
            .into_iter()
            .filter(|(_, name): &(String, String)| {
                matches_filter(name, filter.from, filter.to, filter.only, filter.exact)
            })
            .collect();

    let total = artists.len();
    reporter.info(&format!("{} artist(s) to check", total));
    reporter.blank();

    let mut summary = Summary {
        artists: total,
        ..Default::default()
    };
    let mut seen: HashSet<String> = HashSet::new();

    for (i, (artist_id, artist_name)) in artists.iter().enumerate() {
        let paths = get_owned_track_paths_for_artist(pool, artist_id).await?;

        let mut tagged: Vec<(String, String)> = Vec::new();
        for rel_path in paths {
            if !seen.insert(rel_path.clone()) {
                continue;
            }
            let abs_path = Path::new(music_dir).join(&rel_path);
            if !abs_path.exists() {
                summary.missing += 1;
                continue;
            }
            summary.scanned += 1;
            match read_track_mb_ids(&abs_path) {
                Ok((Some(recording), _)) => tagged.push((rel_path, recording)),
                Ok(_) => {}
                Err(e) => {
                    summary.failed += 1;
                    if verbose {
                        reporter.warn(&e);
                    }
                }
            }
        }

        if tagged.is_empty() {
            continue;
        }

        let values: Vec<String> = tagged.iter().map(|(_, v)| v.clone()).collect();
        let known = get_recordings_for_release_track_ids(pool, &values).await?;

        let mut fixed = 0u32;
        for (rel_path, value) in &tagged {
            let fix = plan_recording_fix(Some(value), known.get(value));
            if fix == RecordingFix::Keep {
                continue;
            }
            let written = if dry_run {
                Ok(true)
            } else {
                apply_recording_fix(&Path::new(music_dir).join(rel_path), &fix, value)
            };
            match written {
                Ok(true) => {
                    fixed += 1;
                    if fix == RecordingFix::Blank {
                        summary.blanked += 1;
                    } else {
                        summary.replaced += 1;
                    }
                    if verbose {
                        let action = if fix == RecordingFix::Blank {
                            "blank"
                        } else {
                            "recording id"
                        };
                        reporter.info(&format!("        {} → {}", rel_path, action));
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    summary.failed += 1;
                    reporter.warn(&e);
                }
            }
        }

        if fixed > 0 {
            reporter.ok(&format!(
                "[{}/{}] {} - {} {} file(s)",
                i + 1,
                total,
                artist_name,
                if dry_run { "would fix" } else { "fixed" },
                fixed
            ));
        }
    }

    Ok(summary)
}
