//! Per-folder index processing, extracted from `main.rs`'s sequential main folder loop - the single
//! largest, most-executed piece of this binary. `FolderCtx` bundles everything the loop body reads
//! (plus the handful of caches genuinely shared *across* folders); `FolderOutcome` is what one folder
//! contributes to the run's totals, returned rather than mutated in place so `process_folder` needs no
//! access to the outer accumulators at all.

use chrono::{NaiveDateTime, Utc};
use common::{
    checkpoint::save_index_checkpoint,
    config::Config,
    db::ensure_artist_cached,
    filters::escape_like,
    mb::resolve::LookupResult,
    progress::Reporter,
    s3::upload_to_s3,
    statistics::update_statistics,
    totals::{update_artist_totals_for_artist, update_release_totals_for_artist},
};
use futures::stream::{FuturesUnordered, StreamExt};
use jwalk::WalkDir;
use rayon::prelude::*;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use crate::metadata::extract_metadata;
use crate::{IndexArgs, AUDIO_EXTENSIONS};
use common::images::{hash_image_file, resolve_release_cover, upload_release_image_to_s3};
use index::db::*;
use index::deletion::delete_removed_tracks;

/// The read-only pieces `process_folder` needs, plus the caches genuinely shared *across* folders
/// (an artist/release id lookup, and a cover-art-already-resolved memo) - everything else about one
/// folder's outcome is returned, not mutated in place.
pub(crate) struct FolderCtx<'a> {
    pub(crate) pool: sqlx::PgPool,
    pub(crate) reporter: &'a Reporter,
    pub(crate) running: &'a AtomicBool,
    pub(crate) args: &'a IndexArgs,
    pub(crate) config: &'a Config,
    pub(crate) music_dir: &'a str,
    pub(crate) use_local: bool,
    pub(crate) use_s3: bool,
    pub(crate) release_img_dir: &'a Path,
    pub(crate) artist_img_dir: &'a Path,
    pub(crate) s3_client: &'a Option<aws_sdk_s3::Client>,
    pub(crate) local_release_members: &'a HashMap<String, String>,
    pub(crate) lookup_memo: &'a HashMap<String, LookupResult>,
    pub(crate) run_hash: &'a Option<String>,
    pub(crate) total_folders: usize,
    pub(crate) target_folders: &'a Option<HashMap<String, Vec<String>>>,
    pub(crate) already_indexed: &'a HashSet<String>,
    pub(crate) artist_cache: &'a mut HashMap<String, String>,
    pub(crate) release_cache: &'a mut HashMap<String, String>,
    pub(crate) mb_id_to_image_hash: &'a mut HashMap<String, String>,
}

/// What one folder contributed to the run's totals - `None` only when the run was cancelled
/// (`running` flipped false) before this folder started, telling the caller to stop the whole loop.
#[derive(Default)]
pub(crate) struct FolderOutcome {
    pub(crate) total_files: u64,
    pub(crate) new_total: u64,
    pub(crate) updated_total: u64,
    pub(crate) skipped_total: u64,
    pub(crate) error_total: u64,
    pub(crate) favorites_dropped_total: u64,
    pub(crate) playlists_dropped_total: u64,
    pub(crate) consensus_reason_totals: HashMap<&'static str, u64>,
    pub(crate) consensus_cleared_total: u64,
    pub(crate) artist_ids: Vec<String>,
}

pub(crate) async fn process_folder(
    folder_idx: usize,
    folder_name: &String,
    ctx: FolderCtx<'_>,
) -> Option<FolderOutcome> {
    let FolderCtx {
        pool,
        reporter,
        running,
        args,
        config,
        music_dir,
        use_local,
        use_s3,
        release_img_dir,
        artist_img_dir,
        s3_client,
        local_release_members,
        lookup_memo,
        run_hash,
        total_folders,
        target_folders,
        already_indexed,
        artist_cache,
        release_cache,
        mb_id_to_image_hash,
    } = ctx;

    let mut total_files: u64 = 0;
    let mut new_total: u64 = 0;
    let mut updated_total: u64 = 0;
    let mut skipped_total: u64 = 0;
    let mut error_total: u64 = 0;
    let mut favorites_dropped_total: u64 = 0;
    let mut playlists_dropped_total: u64 = 0;
    let mut consensus_reason_totals: HashMap<&'static str, u64> = HashMap::new();
    let mut consensus_cleared_total: u64 = 0;

    if !running.load(Ordering::SeqCst) {
        return None;
    }

    if already_indexed.contains(folder_name.as_str()) {
        return Some(FolderOutcome::default());
    }

    let folder_path = PathBuf::from(&music_dir).join(folder_name);

    reporter.item("", folder_name, folder_idx + 1, total_folders);

    // -----------------------------------------------------------------
    // Walk all audio files in this folder recursively
    // -----------------------------------------------------------------
    let walk_roots: Vec<PathBuf> = if let Some(ref tf) = target_folders {
        tf.get(folder_name)
            .map(|subs| {
                subs.iter()
                    .map(|s| PathBuf::from(&music_dir).join(s))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![folder_path.clone()]
    };

    let paths: Vec<PathBuf> = walk_roots
        .iter()
        .flat_map(|root| {
            WalkDir::new(root)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| {
                    if e.file_type().is_dir() {
                        return false;
                    }
                    e.path().extension().is_some_and(|ext| {
                        let el = ext.to_string_lossy().to_lowercase();
                        AUDIO_EXTENSIONS.contains(&el.as_str())
                    })
                })
                .map(|e| e.path().to_path_buf())
        })
        .collect();

    let file_count = paths.len();
    if file_count == 0 {
        reporter.sub_step("0 files");
        if let Some(ref h) = run_hash {
            stamp_folder_index_hash(&pool, folder_name, h).await;
        }
        save_index_checkpoint(&pool, folder_name).await.ok();
        return Some(FolderOutcome::default());
    }
    // -----------------------------------------------------------------
    // Load existing tracks for change detection
    // -----------------------------------------------------------------
    let folder_prefix = format!("{}/", folder_name);
    let existing_paths: HashSet<String> =
        if !args.overwrite && !args.inspect && args.folders.is_none() {
            let rows: Vec<(String,)> = sqlx::query_as(
                r#"SELECT "filePath" FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
            )
            .bind(format!("{}%", escape_like(&folder_prefix)))
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            rows.into_iter().map(|(path,)| path).collect()
        } else {
            HashSet::new()
        };
    let existing_tracks: HashMap<String, (i64, NaiveDateTime, String)> =
        if args.inspect && args.folders.is_none() {
            let rows: Vec<(String, i64, Option<NaiveDateTime>, Option<String>)> = sqlx::query_as(
                r#"SELECT "filePath", "fileSize", mtime, "contentHash"
                   FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
            )
            .bind(format!("{}%", escape_like(&folder_prefix)))
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            rows.into_iter()
                .map(|(path, size, mtime, hash)| {
                    (
                        path,
                        (
                            size,
                            mtime.unwrap_or_else(|| Utc::now().naive_utc()),
                            hash.unwrap_or_default(),
                        ),
                    )
                })
                .collect()
        } else {
            HashMap::new()
        };

    // Default mode: filter out already-indexed paths before extraction
    let paths: Vec<PathBuf> = if !existing_paths.is_empty() {
        let music_dir_prefix = format!("{}/", music_dir);
        paths
            .into_iter()
            .filter(|p| {
                let rel = p
                    .to_string_lossy()
                    .strip_prefix(&music_dir_prefix)
                    .unwrap_or(&p.to_string_lossy())
                    .to_string();
                !existing_paths.contains(&rel)
            })
            .collect()
    } else {
        paths
    };

    let file_count_after = paths.len();
    let pre_skipped = file_count - file_count_after;
    skipped_total += pre_skipped as u64;

    let mut folder_new: u64 = 0;
    let mut folder_updated: u64 = 0;
    let mut folder_skipped: u64 = 0;
    let mut folder_artist_ids: HashSet<String> = HashSet::new();
    let mut folder_releases: HashMap<String, String> = HashMap::new();

    if paths.is_empty() {
        reporter.step(&format!("{} files, all up to date", file_count));
    } else {
        if pre_skipped > 0 {
            reporter.step(&format!(
                "Extracting metadata ({} new of {} files)...",
                file_count_after, file_count
            ));
        } else {
            reporter.step(&format!("Extracting metadata ({} files)...", file_count));
        }
        total_files += file_count as u64;

        // -----------------------------------------------------------------
        // Parallel metadata extraction
        // -----------------------------------------------------------------
        let music_dir_clone = music_dir;

        let par_results: Vec<Result<_, String>> = paths
            .par_iter()
            .map(|p| match extract_metadata(p, music_dir_clone) {
                Ok(meta) => {
                    if meta.artist.is_none() || meta.artist.as_deref() == Some("") {
                        Err(format!("no artist tag: {}", p.display()))
                    } else {
                        Ok(meta)
                    }
                }
                Err(e) => Err(format!("{}: {}", p.display(), e)),
            })
            .collect();

        let mut extracted = Vec::with_capacity(par_results.len());
        let mut parse_errors: Vec<String> = Vec::new();
        for result in par_results {
            match result {
                Ok(meta) => extracted.push(meta),
                Err(msg) => parse_errors.push(msg),
            }
        }
        let folder_errors = parse_errors.len() as u64;
        error_total += folder_errors;
        for msg in &parse_errors {
            reporter.warn(msg);
        }

        if !extracted.is_empty() {
            // -----------------------------------------------------------------
            // Pre-scan: propagate MB IDs within the same logical album
            // -----------------------------------------------------------------
            let mb_release_id_by_meta: HashMap<(String, i32, String), String> = {
                let mut map: HashMap<(String, i32, String), String> = HashMap::new();
                for track in &extracted {
                    if let Some(clean) = track
                        .mb_release_id
                        .as_deref()
                        .and_then(common::filters::sanitize_mb_id)
                    {
                        let key = (
                            track.album.as_deref().unwrap_or("").to_lowercase(),
                            track.year.unwrap_or(0),
                            track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                        );
                        map.entry(key).or_insert(clean);
                    }
                }
                map
            };
            let mb_release_group_id_by_meta: HashMap<(String, i32, String), String> = {
                let mut map: HashMap<(String, i32, String), String> = HashMap::new();
                for track in &extracted {
                    if let Some(clean) = track
                        .mb_release_group_id
                        .as_deref()
                        .and_then(common::filters::sanitize_mb_id)
                    {
                        let key = (
                            track.album.as_deref().unwrap_or("").to_lowercase(),
                            track.year.unwrap_or(0),
                            track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                        );
                        map.entry(key).or_insert(clean);
                    }
                }
                map
            };

            // Per-folder consensus verdict (docs/no_guessing.md) over this run's extracted tracks -
            // seeds a brand-new release's title/status/reason. The folder is the physical release
            // unit: every track in a folder shares one LocalRelease keyed by folder path (see
            // build_group_key). Index never folds multi-disc folders together (docs/sync_decisions.md)
            // - that decision needs MB medium data only sync has.
            let folder_verdicts: HashMap<String, common::consensus::Verdict> = {
                let mut by_folder: HashMap<String, Vec<common::consensus::TrackTags>> =
                    HashMap::new();
                for track in &extracted {
                    let raw = {
                        let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                        if parts.len() > 1 {
                            parts[1].to_string()
                        } else {
                            String::new()
                        }
                    };
                    let fp = strip_disc_subfolder(&raw);
                    by_folder
                        .entry(fp)
                        .or_default()
                        .push(common::consensus::TrackTags {
                            id: track.file_path.clone(),
                            album: track.album.clone(),
                            year: track.year,
                            mb_release_id: track.mb_release_id.clone(),
                            mb_release_group_id: track.mb_release_group_id.clone(),
                            disc_number: track.disc_number,
                            track_number: track.track_number,
                            file_path: Some(track.file_path.clone()),
                        });
                }
                by_folder
                    .into_iter()
                    .map(|(fp, tracks)| (fp, common::consensus::evaluate(&tracks)))
                    .collect()
            };

            // -----------------------------------------------------------------
            // Change detection + build batch
            // -----------------------------------------------------------------
            let mut mtime_updates: Vec<(NaiveDateTime, String)> = Vec::new();
            let mut batch_tracks: Vec<_> = Vec::new();
            let mut pending_release_artist_links: HashSet<(String, String)> = HashSet::new();
            let mut release_mb_key: HashMap<String, String> = HashMap::new();
            let mut releases_with_art: HashSet<String> = HashSet::new();
            let mut releases_already_have_art: HashSet<String> = HashSet::new();
            let mut release_to_image_filename: HashMap<String, String> = HashMap::new();

            for track in &extracted {
                if args.overwrite {
                    new_total += 1;
                    folder_new += 1;
                } else if args.inspect {
                    if let Some((existing_size, existing_mtime, existing_hash)) =
                        existing_tracks.get(&track.file_path)
                    {
                        if *existing_size == track.file_size
                            && (*existing_mtime - track.mtime).num_seconds().abs() < 2
                        {
                            skipped_total += 1;
                            folder_skipped += 1;
                            continue;
                        }
                        if *existing_hash == track.content_hash {
                            mtime_updates.push((track.mtime, track.file_path.clone()));
                            skipped_total += 1;
                            folder_skipped += 1;
                            continue;
                        }
                        updated_total += 1;
                        folder_updated += 1;
                    } else {
                        new_total += 1;
                        folder_new += 1;
                    }
                } else if existing_paths.contains(&track.file_path) {
                    skipped_total += 1;
                    folder_skipped += 1;
                    continue;
                } else {
                    new_total += 1;
                    folder_new += 1;
                }

                // The tag that names this release's owner(s) - albumArtist unless it is a
                // Various-Artists placeholder, then the track's own artist tag. Shared with the
                // resolve pass's owner reconcile (`index::resolve::owner_tag`) so the two can
                // never disagree about which tag they are reconciling.
                let owner_tag: Option<&str> = index::resolve::owner_tag(
                    track.album_artist.as_deref(),
                    track.artist.as_deref(),
                )
                .map(|t| t.value());

                let album_name = track.album.as_deref().unwrap_or("Unknown Album");

                let raw_folder_path = {
                    let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                    if parts.len() > 1 {
                        parts[1].to_string()
                    } else {
                        String::new()
                    }
                };
                let folder_path_str = strip_disc_subfolder(&raw_folder_path);

                let meta_key = (
                    track.album.as_deref().unwrap_or("").to_lowercase(),
                    track.year.unwrap_or(0),
                    track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                );
                // MB ids are kept only for cover-art dedup (below), NOT for grouping - see build_group_key.
                let sanitized_release_id = track
                    .mb_release_id
                    .as_deref()
                    .and_then(common::filters::sanitize_mb_id);
                let sanitized_rg_id = track
                    .mb_release_group_id
                    .as_deref()
                    .and_then(common::filters::sanitize_mb_id);
                let effective_release_id = sanitized_release_id
                    .as_deref()
                    .or_else(|| mb_release_id_by_meta.get(&meta_key).map(|s| s.as_str()));
                let effective_rg_id = sanitized_rg_id.as_deref().or_else(|| {
                    mb_release_group_id_by_meta
                        .get(&meta_key)
                        .map(|s| s.as_str())
                });

                // Index never folds multi-disc siblings together (docs/sync_decisions.md) - each
                // folder always keeps its own folder-derived key. Only sync, once it knows the MB
                // medium structure, decides whether siblings fold into one release or dissolve.
                let group_key = build_group_key(
                    album_name,
                    track.year,
                    track.album_artist.as_deref().unwrap_or(""),
                    &folder_path_str,
                );
                let display_key = folder_path_str.as_str();

                let verdict = folder_verdicts.get(display_key);
                let release_title: String =
                    verdict.and_then(|v| v.title.clone()).unwrap_or_else(|| {
                        common::consensus::folder_leaf(&folder_path_str).to_string()
                    });
                let release_year = verdict.and_then(|v| v.year);
                let (release_status, release_reason): (&str, Option<&str>) =
                    match verdict.and_then(|v| v.reason) {
                        Some(reason) => ("UNKNOWN", Some(reason)),
                        None => ("UNMATCHED", None),
                    };

                // A folder sync's box-set matcher already bound to a release is pinned there -
                // never re-derive a group key for it, or the very next full re-index of a
                // shape-(b) box (every disc tagged as its own standalone album) would split it
                // straight back apart. See get_local_release_members's doc comment.
                let release_result =
                    if let Some(existing_id) = local_release_members.get(&folder_path_str) {
                        Ok(existing_id.clone())
                    } else {
                        ensure_local_release_cached(
                            &pool,
                            &index::db::ReleaseFacts {
                                title: &release_title,
                                year: release_year,
                                folder_path: &folder_path_str,
                                group_key: &group_key,
                                status: release_status,
                                reason: release_reason,
                            },
                            release_cache,
                        )
                        .await
                    };
                let release_id = match release_result {
                    Ok(id) => id,
                    Err(e) => {
                        reporter.err(&format!("DB error (release '{}'): {}", album_name, e));
                        error_total += 1;
                        continue;
                    }
                };

                folder_releases
                    .entry(release_id.clone())
                    .or_insert_with(|| display_key.to_string());

                // Album-artist → release links (main artists)
                match owner_tag {
                    None => {
                        // No albumArtist and no track artist at all - nothing to resolve.
                        if let Ok(aid) =
                            ensure_artist_cached(&pool, "Unknown Artist", artist_cache).await
                        {
                            if !aid.is_empty() {
                                pending_release_artist_links
                                    .insert((release_id.clone(), aid.clone()));
                                folder_artist_ids.insert(aid.clone());
                            }
                        }
                    }
                    Some(owner_tag) => {
                        let owners = index::resolve::resolve_owner_offline(owner_tag, |q| {
                            lookup_memo
                                .get(q)
                                .cloned()
                                .unwrap_or(LookupResult::NeedsFetch)
                        });

                        for (owner_name, owner_mbid) in owners {
                            let Ok(aa_id) =
                                ensure_artist_cached(&pool, &owner_name, artist_cache).await
                            else {
                                continue;
                            };
                            if aa_id.is_empty() {
                                continue;
                            }
                            if let Some(ref mbid) = owner_mbid {
                                // Fill only when empty - never overwrite an id sync established.
                                sqlx::query(
                                r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
                                   WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
                            )
                            .bind(mbid)
                            .bind(&aa_id)
                            .execute(&pool)
                            .await
                            .ok();
                            }
                            pending_release_artist_links
                                .insert((release_id.clone(), aa_id.clone()));
                            folder_artist_ids.insert(aa_id.clone());
                        }
                    }
                }

                // Cover art: short-circuit if this MB release/release-group id already
                // resolved to an image elsewhere in this run, else remember the key so
                // the resolution pass below can populate the hash cache once it finds one.
                if !args.skip_covers {
                    let mb_key = image_key_for_release(effective_release_id, effective_rg_id);
                    if let Some(ref mk) = mb_key {
                        if let Some(existing_filename) = mb_id_to_image_hash.get(mk) {
                            release_to_image_filename
                                .insert(release_id.clone(), existing_filename.clone());
                            releases_already_have_art.insert(release_id.clone());
                        } else {
                            release_mb_key
                                .entry(release_id.clone())
                                .or_insert_with(|| mk.clone());
                        }
                    }
                }

                batch_tracks.push((track, release_id));
            }

            // -----------------------------------------------------------------
            // Flush mtime-only updates (--inspect mode)
            // -----------------------------------------------------------------
            if args.inspect {
                batch_update_mtimes(&pool, &mtime_updates).await.ok();
            }

            // -----------------------------------------------------------------
            // Batch upsert tracks
            // -----------------------------------------------------------------
            if !batch_tracks.is_empty() {
                if let Err(e) = batch_upsert_tracks(&pool, &batch_tracks).await {
                    reporter.err(&format!("Batch upsert error for '{}': {}", folder_name, e));
                    error_total += batch_tracks.len() as u64;
                }
            }

            // -----------------------------------------------------------------
            // No-guessing release placement gate (docs/no_guessing.md). Reads tracks back from
            // the DB (not `extracted`) because `extracted` only holds new/changed files, and the
            // `release_cache` early return means an existing release's other tracks were never
            // part of this run's batch - the DB read is what makes the full folder visible.
            // -----------------------------------------------------------------
            if !folder_releases.is_empty() {
                let touched_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
                match apply_folder_consensus(&pool, &touched_release_ids).await {
                    Ok(stats) => {
                        for (reason, count) in &stats.reason_counts {
                            *consensus_reason_totals.entry(reason).or_insert(0) += count;
                        }
                        consensus_cleared_total += stats.cleared;
                    }
                    Err(e) => {
                        reporter.err(&format!(
                            "Consensus check error for '{}': {}",
                            folder_name, e
                        ));
                    }
                }
            }

            // Batch release-artist links
            if !pending_release_artist_links.is_empty() {
                let links: Vec<(String, String)> =
                    pending_release_artist_links.into_iter().collect();
                batch_ensure_local_release_artists(&pool, &links).await.ok();
            }

            // Print folder summary - verbose only when something actually changed
            {
                if folder_new > 0 || folder_updated > 0 {
                    let mut parts = vec![format!("{} files", file_count)];
                    if folder_new > 0 {
                        parts.push(format!("{} new", folder_new));
                    }
                    if folder_updated > 0 {
                        parts.push(format!("{} updated", folder_updated));
                    }
                    if folder_skipped > 0 {
                        parts.push(format!("{} skipped", folder_skipped));
                    }
                    if folder_errors > 0 {
                        parts.push(format!("{} errors", folder_errors));
                    }
                    reporter.ok(&parts.join(", "));
                } else if folder_errors > 0 {
                    reporter.warn(&format!("{} errors", folder_errors));
                }
            }

            // -----------------------------------------------------------------
            // Cover art: external file (cover/folder/front, jpg/jpeg/png) first;
            // else the embedded picture tag of the release's first audio file
            // (root, or first disc subfolder's) - no scan past that first file.
            // -----------------------------------------------------------------
            if !args.skip_covers {
                let art_targets: Vec<(String, String)> = folder_releases
                    .iter()
                    .filter(|(rid, _)| {
                        !releases_with_art.contains(*rid)
                            && (args.overwrite_with_images
                                || !releases_already_have_art.contains(*rid))
                    })
                    .map(|(rid, fp)| (rid.clone(), fp.clone()))
                    .collect();

                if !art_targets.is_empty() {
                    reporter.step(&format!(
                        "Extracting artwork ({} releases)...",
                        art_targets.len()
                    ));
                    let overwrite_images = args.overwrite_with_images;
                    let rid_clone = release_img_dir;
                    let music_dir_clone = music_dir;
                    let resolved_covers: Vec<(String, String, bool)> = art_targets
                        .par_iter()
                        .filter_map(|(release_id, rel_folder_path)| {
                            let abs_folder = PathBuf::from(&music_dir_clone).join(rel_folder_path);
                            let temp_path = rid_clone.join(format!("_tmp_{}.jpg", release_id));
                            if overwrite_images {
                                std::fs::remove_file(&temp_path).ok();
                            }
                            if !resolve_release_cover(&abs_folder, &temp_path) {
                                return None;
                            }
                            let hash = hash_image_file(&temp_path)?;
                            let final_name = format!("{}.jpg", hash);
                            let final_path = rid_clone.join(&final_name);
                            let newly_written = if final_path.exists() {
                                std::fs::remove_file(&temp_path).ok();
                                false
                            } else {
                                std::fs::rename(&temp_path, &final_path).is_ok()
                            };
                            Some((release_id.clone(), hash, newly_written))
                        })
                        .collect();

                    for (release_id, hash, _) in &resolved_covers {
                        let filename = format!("{}.jpg", hash);
                        release_to_image_filename.insert(release_id.clone(), filename.clone());
                        if let Some(mk) = release_mb_key.get(release_id) {
                            mb_id_to_image_hash
                                .entry(mk.clone())
                                .or_insert_with(|| filename.clone());
                        }
                    }

                    if use_s3 {
                        if let (Some(ref client), Some(ref bucket), Some(ref public_url)) = (
                            &s3_client,
                            &config.storage_bucket,
                            &config.storage_public_url,
                        ) {
                            let mut uploaded_hashes: HashSet<String> = HashSet::new();
                            let mut uploads = FuturesUnordered::new();
                            for (release_id, hash, newly_written) in &resolved_covers {
                                if !newly_written || !uploaded_hashes.insert(hash.clone()) {
                                    continue;
                                }
                                let client = client.clone();
                                let bucket = bucket.clone();
                                let public_url = public_url.clone();
                                let pool2 = pool.clone();
                                let rid = release_id.clone();
                                let image_key = hash.clone();
                                let p = release_img_dir.join(format!("{}.jpg", hash));
                                uploads.push(async move {
                                    upload_release_image_to_s3(
                                        &client,
                                        &bucket,
                                        &public_url,
                                        &pool2,
                                        &rid,
                                        &image_key,
                                        &p,
                                    )
                                    .await;
                                    hash.clone()
                                });
                                if uploads.len() >= 8 {
                                    uploads.next().await;
                                }
                            }
                            while uploads.next().await.is_some() {}
                        }
                    }

                    for (release_id, filename) in &release_to_image_filename {
                        let out_path = release_img_dir.join(filename);
                        if !out_path.exists() && !use_s3 {
                            continue;
                        }
                        if use_local {
                            sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(filename)
                        .bind(release_id)
                        .execute(&pool)
                        .await
                        .ok();
                        }
                        if use_s3 {
                            if let Some(ref public_url) = config.storage_public_url {
                                let image_url = format!(
                                    "{}/releases/{}",
                                    public_url.trim_end_matches('/'),
                                    filename
                                );
                                sqlx::query(
                                r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                            )
                            .bind(&image_url)
                            .bind(release_id)
                            .execute(&pool)
                            .await
                            .ok();
                            }
                        }
                        releases_with_art.insert(release_id.clone());
                    }
                }
            }

            if !args.skip_covers {
                let newly_extracted = release_to_image_filename.len();
                let mb_shortcut = releases_already_have_art
                    .iter()
                    .filter(|rid| release_to_image_filename.contains_key(*rid))
                    .count();
                let hash_deduped = release_to_image_filename
                    .values()
                    .collect::<HashSet<_>>()
                    .len();
                let pre_existing = releases_already_have_art.len() - mb_shortcut;

                if newly_extracted > 0 || mb_shortcut > 0 {
                    let mut parts: Vec<String> = Vec::new();
                    if hash_deduped > 0 {
                        parts.push(format!("{} unique image(s)", hash_deduped));
                    }
                    if newly_extracted > hash_deduped {
                        parts.push(format!(
                            "{} reused via hash",
                            newly_extracted - hash_deduped
                        ));
                    }
                    if mb_shortcut > 0 {
                        parts.push(format!(
                            "{} skipped (same MB ID from previous extraction)",
                            mb_shortcut
                        ));
                    }
                    reporter.ok(&parts.join(", "));
                }
                if pre_existing > 0 {
                    reporter.ok(&format!("{} cover(s) already exist", pre_existing));
                }
            }

            // Clean up temp images in S3-only mode
            if !use_local && use_s3 {
                let mut cleaned: HashSet<String> = HashSet::new();
                for filename in release_to_image_filename.values() {
                    if cleaned.insert(filename.clone()) {
                        let tmp = release_img_dir.join(filename);
                        std::fs::remove_file(&tmp).ok();
                    }
                }
            }
        } // if !extracted.is_empty()
    } // if !paths.is_empty()

    // -----------------------------------------------------------------
    // Backfill: load folder_releases + folder_artist_ids from DB
    // -----------------------------------------------------------------
    {
        let db_releases: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT DISTINCT lr.id, lr."folderPath"
                   FROM "LocalRelease" lr
                   WHERE lr."folderPath" LIKE $1"#,
        )
        // folder_prefix (not folder_name) - it already carries the trailing '/', otherwise this
        // is a prefix match with no boundary and "AC" would swallow "ACDC/...".
        .bind(format!("{}%", escape_like(&folder_prefix)))
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        for (rid, fp) in db_releases {
            folder_releases.entry(rid).or_insert(fp);
        }

        let folder_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
        if !folder_release_ids.is_empty() {
            let album_artists: Vec<(String,)> = sqlx::query_as(
                r#"SELECT DISTINCT lra."artistId"
                       FROM "LocalReleaseArtist" lra
                       WHERE lra."localReleaseId" = ANY($1::text[])"#,
            )
            .bind(&folder_release_ids)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            for (aid,) in album_artists {
                folder_artist_ids.insert(aid);
            }
        }
    }

    // -----------------------------------------------------------------
    // Artist folder image: only the folder's one main artist (most track
    // links - owner or credit - under this root), never co-owners/guests.
    // A various-artists folder (a tribute comp, a box set with many credited
    // performers) has no single face its cover belongs to, so a tie or an
    // empty count leaves every artist under it without a folder-image fallback.
    // -----------------------------------------------------------------
    if !args.skip_covers {
        let counts = folder_artist_track_counts(&pool, &folder_prefix).await;
        if let Some(owner_id) = pick_folder_image_owner(&counts) {
            let existing_img: Option<(Option<String>, Option<String>)> =
                sqlx::query_as(r#"SELECT image, "imageUrl" FROM "Artist" WHERE id = $1"#)
                    .bind(&owner_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten();
            let needs_image = existing_img
                .map(|(img, url)| img.is_none() && url.is_none())
                .unwrap_or(true);

            if needs_image {
                let slug: Option<String> =
                    sqlx::query_as::<_, (String,)>(r#"SELECT slug FROM "Artist" WHERE id = $1"#)
                        .bind(&owner_id)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten()
                        .map(|(s,)| s);

                if let Some(ref artist_slug) = slug {
                    let out_path = artist_img_dir.join(format!("{}.jpg", artist_slug));
                    if common::images::use_artist_folder_image(&folder_path, &out_path) {
                        if use_s3 {
                            if let (Some(ref client), Some(ref bucket), Some(ref public_url)) = (
                                &s3_client,
                                &config.storage_bucket,
                                &config.storage_public_url,
                            ) {
                                let s3_key = format!("artists/{}.jpg", artist_slug);
                                if upload_to_s3(client, bucket, &s3_key, &out_path)
                                    .await
                                    .is_ok()
                                {
                                    let image_url =
                                        format!("{}/{}", public_url.trim_end_matches('/'), s3_key);
                                    sqlx::query(
                                            r#"UPDATE "Artist" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                        )
                                        .bind(&image_url)
                                        .bind(&owner_id)
                                        .execute(&pool)
                                        .await
                                        .ok();
                                }
                            }
                        }
                        if use_local {
                            let filename = format!("{}.jpg", artist_slug);
                            sqlx::query(
                                    r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&filename)
                                .bind(&owner_id)
                                .execute(&pool)
                                .await
                                .ok();
                        }
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // Delete tracks that no longer exist on disk
    // -----------------------------------------------------------------
    // --prune only counts when this pass actually walked the folder and found audio files in it:
    // that is what proves the mount is up, which is the only thing the ratio guard was defending.
    let prune = args.prune && file_count > 0;
    let deleted_tracks = if let Some(ref tf) = target_folders {
        let mut total = 0u64;
        for sub in tf.get(folder_name.as_str()).unwrap_or(&vec![]) {
            let prefix = format!("{}/", sub);
            let res = delete_removed_tracks(&pool, &prefix, music_dir, prune).await;
            favorites_dropped_total += res.favorites_dropped;
            playlists_dropped_total += res.playlists_dropped;
            total += res.count;
        }
        total
    } else {
        let res = delete_removed_tracks(&pool, &folder_prefix, music_dir, prune).await;
        favorites_dropped_total += res.favorites_dropped;
        playlists_dropped_total += res.playlists_dropped;
        res.count
    };

    // Cleanup used to run right here, once per folder - three full-table anti-joins × ~25k folders,
    // for a result nothing in this loop reads. It happens once after the loop instead.

    // -----------------------------------------------------------------
    // Update totals + lastIndexedAt
    // -----------------------------------------------------------------
    for aid in &folder_artist_ids {
        update_release_totals_for_artist(&pool, aid).await.ok();
        update_artist_totals_for_artist(&pool, aid).await.ok();
        propagate_mb_artist_id(&pool, aid).await.ok();
    }

    let outcome_artist_ids: Vec<String> = folder_artist_ids.iter().cloned().collect();
    let artist_ids_vec: Vec<String> = folder_artist_ids.into_iter().collect();
    if folder_new > 0 || folder_updated > 0 || deleted_tracks > 0 {
        update_last_indexed_at(&pool, &artist_ids_vec).await.ok();
    }

    // -----------------------------------------------------------------
    // Upsert FolderScan + save checkpoint + stamp run hash
    // -----------------------------------------------------------------
    if let Ok(meta) = std::fs::metadata(&folder_path) {
        if let Ok(sys_mtime) = meta.modified() {
            if let Ok(dur) = sys_mtime.duration_since(std::time::UNIX_EPOCH) {
                if let Some(dt) =
                    chrono::DateTime::from_timestamp(dur.as_secs() as i64, 0).map(|d| d.naive_utc())
                {
                    upsert_folder_scan(&pool, folder_name, dt).await.ok();
                }
            }
        }
    }
    if let Some(ref h) = run_hash {
        stamp_folder_index_hash(&pool, folder_name, h).await;
    }
    save_index_checkpoint(&pool, folder_name).await.ok();
    // update_statistics is 13 full-table aggregate scans - throttle to every 50 folders instead of
    // every single one (19K+ folders = 250K+ scans per full run otherwise). The guaranteed call
    // after the loop (below) always catches the tail, so stats are never more than 50 folders stale.
    if folder_idx.is_multiple_of(50) {
        update_statistics(&pool).await.ok();
    }

    // Emit structured progress for terminal UI
    reporter.index_progress(
        folder_name,
        folder_idx + 1,
        total_folders,
        common::progress::FolderTally {
            new: folder_new,
            updated: folder_updated,
            skipped: folder_skipped,
            deleted: deleted_tracks,
        },
    );

    Some(FolderOutcome {
        total_files,
        new_total,
        updated_total,
        skipped_total,
        error_total,
        favorites_dropped_total,
        playlists_dropped_total,
        consensus_reason_totals,
        consensus_cleared_total,
        artist_ids: outcome_artist_ids,
    })
}
