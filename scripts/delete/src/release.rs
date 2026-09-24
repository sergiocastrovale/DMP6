//! `./delete --release <localReleaseId>`: removes one release from the catalogue without touching
//! the rest of the owning artist's(s') releases. Mirrors `main.rs`'s artist-delete flow (read plan
//! before the transaction, delete images, delete DB rows in a transaction, then optionally the files)
//! but scoped to a single `LocalRelease` and with one extra rule the artist path doesn't need: the
//! `MusicBrainzRelease` this release was matched to is deleted only if nothing else still needs it -
//! a duplicate copy bound to the same edition, a box parent, or a dissolved disc's track links.

use colored::*;
use common::{
    config::Config,
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    statistics::update_statistics,
    totals::{
        recompute_artist_completeness, update_artist_totals_for_artist,
        zero_totals_for_ownerless_artists,
    },
};
use sqlx::PgPool;
use std::collections::HashSet;
use std::io::{self, Write};

#[derive(Debug)]
pub struct ReleasePlan {
    pub id: String,
    pub title: String,
    pub image: Option<String>,
    pub image_url: Option<String>,
    /// The release's own folder(s): `folderPath` plus every `LocalReleaseMember.folderPath` - a
    /// folded box has one member row per disc, each with its own folder.
    pub folder_paths: Vec<String>,
    /// `LocalReleaseTrack.filePath` values, read before the transaction - once the tracks are gone
    /// there is nothing left to tell `--files` which files belonged to this release.
    pub track_paths: Vec<String>,
    pub track_count: i64,
    /// MB releases this local release is bound to: its own `releaseId` and, if it is a bound box
    /// disc, the box's `MusicBrainzRelease` id via `boxReleaseId`.
    pub mb_candidates: Vec<String>,
    /// `LocalReleaseArtist` owners - totals/score are recomputed for these, and they're candidates
    /// for the orphan-artist sweep if this was their only release.
    pub owner_artist_ids: Vec<String>,
    /// `TrackRelatedArtist` credits on this release's tracks, outside its own owners - cascades away
    /// with the tracks, so these artists also need the orphan sweep.
    pub credited_artist_ids: Vec<String>,
}

pub async fn build_plan(
    pool: &PgPool,
    local_release_id: &str,
) -> Result<Option<ReleasePlan>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct LocalReleaseHeaderRow {
        id: String,
        title: String,
        image: Option<String>,
        #[sqlx(rename = "imageUrl")]
        image_url: Option<String>,
        #[sqlx(rename = "folderPath")]
        folder_path: Option<String>,
        #[sqlx(rename = "releaseId")]
        release_id: Option<String>,
        #[sqlx(rename = "boxReleaseId")]
        box_release_id: Option<String>,
    }

    let row: Option<LocalReleaseHeaderRow> = sqlx::query_as(
        r#"SELECT id, title, image, "imageUrl", "folderPath", "releaseId", "boxReleaseId"
               FROM "LocalRelease" WHERE id = $1"#,
    )
    .bind(local_release_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };
    let LocalReleaseHeaderRow {
        id,
        title,
        image,
        image_url,
        folder_path,
        release_id,
        box_release_id,
    } = row;

    let member_paths: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT "folderPath" FROM "LocalReleaseMember" WHERE "localReleaseId" = $1"#,
    )
    .bind(&id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(p,)| p)
    .collect();

    let mut folder_paths: Vec<String> = folder_path.into_iter().collect();
    folder_paths.extend(member_paths);
    folder_paths.sort();
    folder_paths.dedup();

    let track_paths: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT "filePath" FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
    )
    .bind(&id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(p,)| p)
    .collect();

    let (track_count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#)
            .bind(&id)
            .fetch_one(pool)
            .await?;

    let mut mb_candidates: HashSet<String> = HashSet::new();
    if let Some(rid) = &release_id {
        mb_candidates.insert(rid.clone());
    }
    if let Some(bid) = &box_release_id {
        mb_candidates.insert(bid.clone());
    }

    let owner_artist_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1"#,
    )
    .bind(&id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(a,)| a)
    .collect();

    let credited_artist_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT tra."artistId" FROM "TrackRelatedArtist" tra
           JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
           WHERE lrt."localReleaseId" = $1"#,
    )
    .bind(&id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(a,)| a)
    .collect();

    Ok(Some(ReleasePlan {
        id,
        title,
        image,
        image_url,
        folder_paths,
        track_paths,
        track_count,
        mb_candidates: mb_candidates.into_iter().collect(),
        owner_artist_ids,
        credited_artist_ids,
    }))
}

/// One MB candidate, orphaned or not - drives both the plan printout and the deletion query.
pub struct MbVerdict {
    pub id: String,
    pub orphaned: bool,
}

/// Would deleting `plan`'s LocalRelease leave MB release `mb_id` unreferenced? Checked against the
/// state BEFORE the transaction - a duplicate copy (another LocalRelease.releaseId/boxReleaseId
/// pointing at it) or a dissolved box disc's track link (LocalReleaseTrack.mbTrackId into it) keeps
/// it alive. This is the duplicate-copy guard: deleting one of two copies bound to the same edition
/// must never take the edition down with it.
pub async fn mb_is_orphaned(pool: &PgPool, mb_id: &str, own_release_id: &str) -> bool {
    let (still_needed,): (bool,) = sqlx::query_as(
        r#"SELECT EXISTS (
             SELECT 1 FROM "LocalRelease" lr
             WHERE lr.id <> $2 AND (lr."releaseId" = $1 OR lr."boxReleaseId" = $1)
           ) OR EXISTS (
             SELECT 1 FROM "LocalReleaseTrack" lt
             JOIN "MusicBrainzReleaseTrack" mt ON mt.id = lt."mbTrackId"
             WHERE mt."releaseId" = $1 AND lt."localReleaseId" <> $2
           ) OR EXISTS (
             SELECT 1 FROM "MusicBrainzReleaseMedium" md
             WHERE md."equivalentReleaseId" = $1 AND md."releaseId" <> $1
           ) OR EXISTS (
             SELECT 1 FROM "MusicBrainzRelease" m WHERE m.id = $1 AND m.status = 'MISSING'
           )"#,
    )
    .bind(mb_id)
    .bind(own_release_id)
    .fetch_one(pool)
    .await
    .unwrap_or((true,));
    !still_needed
}

/// Deletes the release, then the MusicBrainz releases and cover nothing else uses any more.
pub async fn execute_plan(
    pool: &PgPool,
    config: &Config,
    plan: &ReleasePlan,
) -> Result<(), sqlx::Error> {
    // Cascades: tracks, members, LocalReleaseArtist, TrackRelatedArtist, favorites, playlist rows,
    // issues. DownloadedRelease.localReleaseId is set NULL.
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = $1"#)
        .bind(&plan.id)
        .execute(pool)
        .await?;

    common::cleanup::delete_orphaned_mb_releases(
        pool,
        common::cleanup::MbSweepScope::Releases(&plan.mb_candidates),
    )
    .await?;

    let images: Vec<String> = plan
        .image
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect();
    common::images::delete_unreferenced_release_images(pool, config, &images).await;
    Ok(())
}

/// Entry point called from `main.rs` when `--release` is given.
pub async fn run(
    pool: &PgPool,
    config: &Config,
    local_release_id: &str,
    skip_confirm: bool,
    files: bool,
    dry_run: bool,
) {
    let plan = match build_plan(pool, local_release_id).await {
        Ok(plan) => plan,
        Err(e) => {
            error_log::log_error(&format!("Database error: {}", e));
            eprintln!("{} Database error: {}", "✗".red(), e);
            std::process::exit(1);
        }
    };
    let Some(plan) = plan else {
        error_log::log_error(&format!("No release found with id '{}'", local_release_id));
        eprintln!(
            "{} No release found with id '{}'",
            "✗".red(),
            local_release_id
        );
        std::process::exit(1);
    };

    println!("Target  : {}", plan.title.bright_white());
    println!();

    let mut verdicts: Vec<MbVerdict> = Vec::new();
    for mb_id in &plan.mb_candidates {
        let orphaned = mb_is_orphaned(pool, mb_id, &plan.id).await;
        verdicts.push(MbVerdict {
            id: mb_id.clone(),
            orphaned,
        });
    }

    println!("{}", "Plan".bright_cyan().bold());
    println!("{}", "----".bright_black());
    println!(
        "Local tracks    : {}",
        plan.track_count.to_string().bright_white()
    );
    if plan.folder_paths.is_empty() {
        println!("Folder(s)       : {}", "none on record".bright_black());
    } else {
        for f in &plan.folder_paths {
            println!("    {} {}", "•".bright_black(), f.bright_white());
        }
    }
    if plan.mb_candidates.is_empty() {
        println!("MB release      : {}", "none (unmatched)".bright_black());
    } else {
        for v in &verdicts {
            let verb = if v.orphaned {
                "deleted".red()
            } else {
                "kept - still needed elsewhere".green()
            };
            println!("MB release      : {} ({})", v.id.bright_white(), verb);
        }
    }
    if files {
        println!(
            "Files on disk   : {} {}",
            plan.track_paths.len().to_string().bright_white(),
            "(will be DELETED from MUSIC_DIR)".red().bold()
        );
    }
    println!();

    if dry_run {
        if files {
            if let Some(music_dir) = config.music_dir.as_deref() {
                let result = crate::files::delete_release_folders(
                    &plan.track_paths,
                    &plan.folder_paths,
                    music_dir,
                    true,
                );
                println!(
                    "  {} would remove {} file(s), {} folder(s)",
                    "✓".green(),
                    result.files_removed,
                    result.dirs_removed
                );
            }
        }
        println!("{} (dry run - no changes made)", "✓".green());
        return;
    }

    if !skip_confirm {
        print!("Type y to confirm: ");
        io::stdout().flush().unwrap();
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim().to_lowercase() != "y" {
            println!("Aborted.");
            std::process::exit(0);
        }
        println!();
    }

    // Same DB scan lock index/sync/artist-delete use, acquired only now.
    if clear_stale_lock_minutes(pool, common::lock::STALE_LOCK_MINUTES).await {
        eprintln!("{}", "Cleared a stale lock.".yellow());
    }
    let _lock_guard = match acquire_lock(pool, "delete", std::process::id()).await {
        Ok(g) => g,
        Err(e) => {
            eprintln!("{}: {}", "Cannot start".red(), e);
            std::process::exit(1);
        }
    };

    println!("Deleting...");
    if let Err(e) = execute_plan(pool, config, &plan).await {
        error_log::log_error(&format!("Database error: {}", e));
        eprintln!("  {} Database error: {}", "✗".red(), e);
        release_lock(pool, "delete", std::process::id()).await;
        std::process::exit(1);
    }

    if files {
        if let Some(music_dir) = config.music_dir.as_deref() {
            let result = crate::files::delete_release_folders(
                &plan.track_paths,
                &plan.folder_paths,
                music_dir,
                false,
            );
            println!(
                "  {} removed {} file(s), {} folder(s)",
                "✓".green(),
                result.files_removed,
                result.dirs_removed
            );
            if !result.skipped.is_empty() {
                println!(
                    "  {} {} path(s) skipped (outside MUSIC_DIR, missing, or not removable)",
                    "!".yellow(),
                    result.skipped.len()
                );
            }
        } else {
            eprintln!(
                "  {} MUSIC_DIR is not configured - no files deleted",
                "✗".red()
            );
            error_log::log_error("--files requested but MUSIC_DIR is not configured");
        }
    }

    // Every artist this release touched (owners + credited) may now be ownerless, may have lost its
    // only credit, or simply needs its totals/score refreshed for what remains.
    let mut touched_artist_ids: Vec<String> = plan.owner_artist_ids.clone();
    touched_artist_ids.extend(plan.credited_artist_ids.clone());
    touched_artist_ids.sort();
    touched_artist_ids.dedup();

    for aid in &plan.owner_artist_ids {
        update_artist_totals_for_artist(pool, aid).await.ok();
        recompute_artist_completeness(pool, aid).await.ok();
    }
    zero_totals_for_ownerless_artists(pool, &touched_artist_ids)
        .await
        .ok();

    if !touched_artist_ids.is_empty() {
        let removed =
            index::deletion::delete_orphan_artists(pool, config, Some(&touched_artist_ids)).await;
        if removed > 0 {
            println!(
                "  {} {} now-ownerless artist(s) removed",
                "✓".green(),
                removed
            );
        }
    }

    update_statistics(pool).await.ok();
    release_lock(pool, "delete", std::process::id()).await;

    println!();
    println!(
        "{} {} deleted.",
        "✓".green().bold(),
        plan.title.bright_white()
    );
}
