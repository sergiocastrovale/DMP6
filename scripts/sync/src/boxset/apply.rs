use super::*;
use std::collections::HashMap;

use crate::db::*;
use chrono::Utc;
use common::mb::types::MbRelease;
use sqlx::PgPool;

// Apply - persist a successful plan
// ---------------------------------------------------------------------------

/// Persist the box's own `MusicBrainzRelease` + media + tracks. Pure MB-side work, no `LocalRelease`
/// mutation - the caller decides fold vs dissolve afterward (docs/sync_decisions.md), once
/// `box_editions::run_link_box_editions` has had a chance to derive equivalences, which needs these
/// media rows to exist first. Returns the box's `MusicBrainzRelease.id`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_box_media(
    pool: &PgPool,
    release: &MbRelease,
    rg_id: &str,
    primary_type: Option<&str>,
    candidate: &BoxCandidate,
    plan: &BoxBindPlan,
    release_type_cache: &mut HashMap<String, String>,
    artist_id: &str,
    artist_genre_ids: &[String],
) -> Result<String, sqlx::Error> {
    let type_name = primary_type.unwrap_or("Other");
    let type_id = ensure_release_type_cached(pool, type_name, release_type_cache).await?;
    let year = release
        .date
        .as_deref()
        .and_then(|d| d.split('-').next())
        .and_then(|y| y.parse::<i32>().ok());
    let format_str = crate::status::format_from_media(&release.media);
    let extras = MbReleaseExtras {
        release_date: release.date.as_deref(),
        packaging: release.packaging.as_deref(),
        country: release.country.as_deref(),
        format: format_str.as_deref(),
        ..Default::default()
    };
    // Box-level status only, at this stage: whether every medium is owned by some sibling. Per-disc
    // status (COMPLETE/MISSING_TRACKS scored against the right target, fold or dissolved) is left
    // UNKNOWN by apply_fold/apply_dissolve below and picked up by the ordinary bind path's
    // medium-scoped check_release_status on this artist's next sync pass - the same "next sync
    // re-scores it" convention the old tier-1 fold already relied on.
    let complete = plan.members.len() == candidate.media.len();
    let status = if complete {
        "COMPLETE"
    } else {
        "MISSING_TRACKS"
    };
    let reason = (!complete).then(|| {
        format!(
            "{} of {} discs present",
            plan.members.len(),
            candidate.media.len()
        )
    });

    let mb_db_id = upsert_mb_release_with_media(
        pool,
        &plan.release_id,
        rg_id,
        &release.title,
        year,
        &type_id,
        status,
        reason.as_deref(),
        release.disambiguation.as_deref(),
        &extras,
        candidate.media.len() as i32,
    )
    .await?;
    sync_mb_media_for_release(pool, &mb_db_id, &mb_medium_rows(&release.media)).await?;
    ensure_mb_release_artist_link(pool, &mb_db_id, artist_id)
        .await
        .ok();
    batch_link_release_genres(pool, &mb_db_id, artist_genre_ids)
        .await
        .ok();

    let flattened = common::mb::api::flatten_audio_tracks(&release.media);
    let track_rows: Vec<MbTrackRow> = flattened
        .iter()
        .map(|t| MbTrackRow {
            title: t.title.clone(),
            position: t.position.map(|p| p as i32),
            disc_number: t.disc_number.map(|d| d as i32),
            duration_ms: t.length.map(|l| l as i32),
            mb_id: Some(t.id.clone()),
            recording_id: t.recording.as_ref().map(|r| r.id.clone()),
        })
        .collect();
    let inserted = sync_mb_tracks_for_release(pool, &mb_db_id, &track_rows).await?;

    // Link each sibling's local tracks to the box's own MB track rows. Kept the same for both fold
    // and dissolve outcomes as a deliberate simplification: after a dissolve the tracks conceptually
    // belong to the equivalent target release, but re-matching them against the target's own track
    // rows is a second matching pass this rollout doesn't do - the linked recording is identical
    // either way (that's what the equivalence match already proved), just catalogued under the box's
    // release-scoped track id rather than the target's.
    let track_links: Vec<(String, String)> = plan
        .track_links
        .iter()
        .filter_map(|(local_id, mb_raw)| {
            inserted
                .iter()
                .find(|(_, mid)| mid.as_deref() == Some(mb_raw.as_str()))
                .map(|(db_id, _)| (local_id.clone(), db_id.clone()))
        })
        .collect();
    link_local_tracks_to_mb(pool, &track_links).await.ok();

    Ok(mb_db_id)
}

// ---------------------------------------------------------------------------
// Fold vs dissolve (docs/sync_decisions.md)
// ---------------------------------------------------------------------------

pub(crate) enum BoxOutcome {
    Fold,
    Dissolve,
}

/// Flat `>= 2` threshold, no "majority" clause, at every box size - a 9-medium box with only 2
/// confirmed equivalents still dissolves; its other 7 discs correctly render as their own box-disc
/// rows rather than hiding 2 known editions inside one folded card.
pub(crate) fn decide_outcome(equivalent_count: usize) -> BoxOutcome {
    if equivalent_count >= 2 {
        BoxOutcome::Dissolve
    } else {
        BoxOutcome::Fold
    }
}

pub(crate) async fn count_equivalents(pool: &PgPool, mb_db_id: &str) -> Result<usize, sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT count(*) FROM "MusicBrainzReleaseMedium"
           WHERE "releaseId" = $1 AND "equivalentReleaseId" IS NOT NULL"#,
    )
    .bind(mb_db_id)
    .fetch_one(pool)
    .await?;
    Ok(count.max(0) as usize)
}

/// Genuine multi-disc release (0 or 1 equivalent medium): merge every sibling into one `LocalRelease`,
/// bound to the box itself. Folder-derived `groupKey` (`"folder:{ancestor}"`, never
/// `"mbrelease:{id}"` - the latter collides when two local copies of one box both plan the same key,
/// which is exactly what `./audit --duplicate-release` needs to be able to tell apart).
///
/// `Ok(false)` when the box's root folder is already its own, *different* `LocalRelease` (a real album
/// genuinely filed at that exact path - the fold would need to delete or rehome it, which is a
/// decision for a person, not something this repair invents on its own). Nothing is written; the
/// group is left as it is and counted separately (`groups_key_taken`).
pub(crate) async fn apply_fold(
    pool: &PgPool,
    plan: &BoxBindPlan,
    mb_db_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let local_ids: Vec<String> = plan.members.iter().map(|(id, _)| id.clone()).collect();
    let key_holder: Option<String> = sqlx::query_scalar(
        r#"SELECT id FROM "LocalRelease" WHERE "groupKey" = $1 AND id <> ALL($2)"#,
    )
    .bind(format!("folder:{}", plan.folder_path))
    .bind(&local_ids)
    .fetch_optional(pool)
    .await?;
    if key_holder.is_some() {
        return Ok(None);
    }

    let folder_rows: Vec<(String, Option<String>)> =
        sqlx::query_as(r#"SELECT id, "folderPath" FROM "LocalRelease" WHERE id = ANY($1)"#)
            .bind(&local_ids)
            .fetch_all(pool)
            .await?;
    let folder_by_id: HashMap<String, String> = folder_rows
        .into_iter()
        .map(|(id, fp)| (id, fp.unwrap_or_default()))
        .collect();

    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;

    // Stamp discNumber from the medium position BEFORE tracks move onto the survivor - once merged,
    // "which sibling did this track come from" is no longer recoverable from localReleaseId alone.
    for (local_id, position) in &plan.members {
        sqlx::query(
            r#"UPDATE "LocalReleaseTrack" SET "discNumber" = $1, "updatedAt" = $2 WHERE "localReleaseId" = $3"#,
        )
        .bind(position)
        .bind(now)
        .bind(local_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET "localReleaseId" = $1, "updatedAt" = $2 WHERE "localReleaseId" = ANY($3)"#,
    )
    .bind(&plan.survivor)
    .bind(now)
    .bind(&plan.absorbed)
    .execute(&mut *tx)
    .await?;
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1)"#)
        .bind(&plan.absorbed)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "groupKey" = $1, "folderPath" = $2, "releaseId" = $3, "mediumPosition" = NULL,
               "boxReleaseId" = NULL, "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN',
               "statusReason" = NULL, "updatedAt" = $4
           WHERE id = $5"#,
    )
    .bind(format!("folder:{}", plan.folder_path))
    .bind(&plan.folder_path)
    .bind(mb_db_id)
    .bind(now)
    .bind(&plan.survivor)
    .execute(&mut *tx)
    .await?;

    // One LocalReleaseMember per sibling (survivor included) so a plain re-index recognises every
    // folder next time instead of re-splitting a box whose discs all tag discNumber=1 (shape (b)).
    for (local_id, position) in &plan.members {
        let folder = folder_by_id
            .get(local_id.as_str())
            .map(String::as_str)
            .unwrap_or_default();
        let member_id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseMember" (id, "localReleaseId", "folderPath", "discNumber")
               VALUES ($1, $2, $3, $4)
               ON CONFLICT ("folderPath") DO UPDATE SET
                 "localReleaseId" = EXCLUDED."localReleaseId", "discNumber" = EXCLUDED."discNumber""#,
        )
        .bind(&member_id)
        .bind(&plan.survivor)
        .bind(folder)
        .bind(position)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Some(plan.survivor.clone()))
}

/// Box set (>=2 equivalent media): leave every sibling as its own `LocalRelease` row. Each disc binds
/// individually - to the standalone album it reprints (provenance recorded via `boxReleaseId`/
/// `boxMediumPosition`), or to the box itself when it has no equivalent (a rarities/bonus disc, or one
/// below tier 3's title/track-count gates). No `LocalReleaseMember` rows - dissolve never folds.
pub(crate) async fn apply_dissolve(
    pool: &PgPool,
    plan: &BoxBindPlan,
    mb_db_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    let mut changed: Vec<String> = Vec::new();
    for (local_id, position) in &plan.members {
        // LEFT JOINs the equivalent's own release row rather than trusting the id at face value: a
        // dangling `equivalentReleaseId` (the target release deleted after the equivalence was
        // derived - box_editions clears these before re-deriving, but a defensive check here costs
        // nothing) must read as "no equivalent" and bind to the box, never reach the foreign key that
        // column write would otherwise violate.
        let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
            r#"SELECT m."equivalentReleaseId", m."equivalentMediumPosition"
               FROM "MusicBrainzReleaseMedium" m
               LEFT JOIN "MusicBrainzRelease" target ON target.id = m."equivalentReleaseId"
               WHERE m."releaseId" = $1 AND m."position" = $2
                 AND (m."equivalentReleaseId" IS NULL OR target.id IS NOT NULL)"#,
        )
        .bind(mb_db_id)
        .bind(position)
        .fetch_optional(&mut *tx)
        .await?;
        let equivalent: Option<(String, Option<i32>)> =
            row.and_then(|(release_id, medium_position)| release_id.map(|r| (r, medium_position)));

        // `matchStatus = 'UNKNOWN'` means "score this again", so it must only be written when the
        // binding actually moves. This pass runs at the tail of *every* sync and re-derives the same
        // plan for a box that is already dissolved, so writing it unconditionally left those discs
        // permanently unscored: the release loop scored them, the tail reset them, and the next run
        // repeated it. ABBA's nine-disc box sat at UNKNOWN through three consecutive syncs that way.
        // The `WHERE` clauses below make each write a no-op once the row already says this.
        match equivalent {
            Some((equivalent_release_id, equivalent_medium_position)) => {
                let res = sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = $3,
                           "boxMediumPosition" = $4, "matchStatus" = 'UNKNOWN', "statusReason" = NULL,
                           "updatedAt" = $5
                       WHERE id = $6
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS DISTINCT FROM $3
                           OR "boxMediumPosition" IS DISTINCT FROM $4)"#,
                )
                .bind(&equivalent_release_id)
                .bind(equivalent_medium_position)
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(&mut *tx)
                .await?;
                if res.rows_affected() > 0 {
                    changed.push(local_id.clone());
                }
            }
            None => {
                let res = sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = NULL,
                           "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN', "statusReason" = NULL,
                           "updatedAt" = $3
                       WHERE id = $4
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS NOT NULL
                           OR "boxMediumPosition" IS NOT NULL)"#,
                )
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(&mut *tx)
                .await?;
                if res.rows_affected() > 0 {
                    changed.push(local_id.clone());
                }
            }
        }
    }
    tx.commit().await?;
    Ok(changed)
}

// ---------------------------------------------------------------------------
