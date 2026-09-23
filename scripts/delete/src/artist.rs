//! `./delete "Artist"`: removes artists and the releases only they own. A release another,
//! surviving artist also owns is kept - only the deleted artists' ownership links go.

use common::config::Config;
use sqlx::PgPool;
use std::collections::HashSet;

#[derive(Debug)]
pub struct ArtistAction {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub is_cascaded: bool,
    /// Credits on tracks OUTSIDE the deletion set - purely informational, since this artist is deleted
    /// either way and those TrackRelatedArtist rows cascade away with it. Surfaced so the operator sees
    /// what else loses a credit before confirming.
    pub other_credits_count: i64,
}

#[derive(Debug, Default)]
pub struct DeletionPlan {
    pub artist_actions: Vec<ArtistAction>,
    /// Every local release an in-scope artist owns: their ownership links are removed.
    pub owned_releases: Vec<String>,
    /// The subset left with no owner once those links go - these are deleted.
    pub doomed_releases: Vec<String>,
    pub mb_releases: Vec<String>,
    pub track_count: i64,
    /// Absolute `LocalReleaseTrack.filePath` values, read BEFORE the transaction - once the rows are
    /// gone there is nothing left to tell `--files` which files belonged to the artist.
    pub track_paths: Vec<String>,
}

pub async fn build_plan(
    pool: &PgPool,
    target_ids: &[(String, String)],
) -> Result<DeletionPlan, sqlx::Error> {
    // Collect all local + MB release IDs across all targets
    let mut local_release_ids: Vec<String> = Vec::new();
    let mut mb_release_ids: Vec<String> = Vec::new();
    let mut seen_local: HashSet<String> = HashSet::new();
    let mut seen_mb: HashSet<String> = HashSet::new();

    for (tid, _) in target_ids {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(tid)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            if seen_local.insert(id.clone()) {
                local_release_ids.push(id);
            }
        }

        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(tid)
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            if seen_mb.insert(id.clone()) {
                mb_release_ids.push(id);
            }
        }
    }

    let local_set: HashSet<String> = local_release_ids.iter().cloned().collect();
    let mb_set: HashSet<String> = mb_release_ids.iter().cloned().collect();

    // Co-artist cascade: find artists whose entire catalogue is within deletion set
    let mut candidate_ids: HashSet<String> = HashSet::new();
    if !local_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
               WHERE "localReleaseId" = ANY($1::text[]) AND "artistId" <> ALL($2::text[])"#,
        )
        .bind(&local_release_ids)
        .bind(
            &target_ids
                .iter()
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>(),
        )
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }
    if !mb_release_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
               WHERE "releaseId" = ANY($1::text[]) AND "artistId" <> ALL($2::text[])"#,
        )
        .bind(&mb_release_ids)
        .bind(
            &target_ids
                .iter()
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>(),
        )
        .fetch_all(pool)
        .await?;
        for (id,) in rows {
            candidate_ids.insert(id);
        }
    }

    let mut cascaded: HashSet<String> = HashSet::new();
    for cand in &candidate_ids {
        let cand_local: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        let cand_mb: HashSet<String> = sqlx::query_as::<_, (String,)>(
            r#"SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(cand)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        let local_ok = cand_local.is_subset(&local_set);
        let mb_ok = cand_mb.is_subset(&mb_set);
        let has_anything = !cand_local.is_empty() || !cand_mb.is_empty();

        if local_ok && mb_ok && has_anything {
            cascaded.insert(cand.clone());
        }
    }

    // All artist IDs in scope
    let mut all_artist_ids: Vec<String> = target_ids.iter().map(|(id, _)| id.clone()).collect();
    all_artist_ids.extend(cascaded.iter().cloned());

    let mut artist_actions: Vec<ArtistAction> = Vec::new();
    for aid in &all_artist_ids {
        let (other_credits,): (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM "TrackRelatedArtist" tra
               JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
               WHERE tra."artistId" = $1
                 AND lrt."localReleaseId" <> ALL($2::text[])"#,
        )
        .bind(aid)
        .bind(&local_release_ids)
        .fetch_one(pool)
        .await?;

        let row: (String, String, String) =
            sqlx::query_as(r#"SELECT id, name, slug FROM "Artist" WHERE id = $1"#)
                .bind(aid)
                .fetch_one(pool)
                .await?;

        artist_actions.push(ArtistAction {
            id: row.0,
            name: row.1,
            slug: row.2,
            is_cascaded: cascaded.contains(aid),
            other_credits_count: other_credits,
        });
    }

    let doomed_releases: Vec<String> = if local_release_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_scalar(
            r#"SELECT lr.id FROM "LocalRelease" lr
               WHERE lr.id = ANY($1::text[])
                 AND NOT EXISTS (
                       SELECT 1 FROM "LocalReleaseArtist" lra
                       WHERE lra."localReleaseId" = lr.id AND lra."artistId" <> ALL($2::text[]))"#,
        )
        .bind(&local_release_ids)
        .bind(&all_artist_ids)
        .fetch_all(pool)
        .await?
    };

    // MusicBrainz releases bound to a doomed release are candidates too, credited or not; the
    // guarded sweep keeps any still in use.
    let bound: Vec<String> = sqlx::query_scalar(
        r#"SELECT DISTINCT x FROM "LocalRelease" lr,
                LATERAL (VALUES (lr."releaseId"), (lr."boxReleaseId")) v(x)
           WHERE lr.id = ANY($1::text[]) AND x IS NOT NULL"#,
    )
    .bind(&doomed_releases)
    .fetch_all(pool)
    .await?;
    for id in bound {
        if seen_mb.insert(id.clone()) {
            mb_release_ids.push(id);
        }
    }

    let track_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])"#,
    )
    .bind(&doomed_releases)
    .fetch_one(pool)
    .await?;

    let track_paths: Vec<String> = sqlx::query_scalar(
        r#"SELECT "filePath" FROM "LocalReleaseTrack" WHERE "localReleaseId" = ANY($1::text[])"#,
    )
    .bind(&doomed_releases)
    .fetch_all(pool)
    .await?;

    Ok(DeletionPlan {
        artist_actions,
        owned_releases: local_release_ids,
        doomed_releases,
        mb_releases: mb_release_ids,
        track_count,
        track_paths,
    })
}

/// Deletes the plan in one transaction, then the images nothing references any more.
/// Returns the removed image counts (local files, S3 objects).
pub async fn execute_plan(
    pool: &PgPool,
    plan: &DeletionPlan,
    config: &Config,
    keep_artist_images: bool,
) -> Result<(usize, usize), sqlx::Error> {
    let all_artist_ids: Vec<String> = plan.artist_actions.iter().map(|a| a.id.clone()).collect();
    // An artist still credited on tracks outside the deletion set survives as a credit-only artist:
    // deleting the row would strip those credits from releases nobody asked to touch.
    let delete_ids: Vec<String> = plan
        .artist_actions
        .iter()
        .filter(|a| a.other_credits_count == 0)
        .map(|a| a.id.clone())
        .collect();

    let release_images = common::images::release_images(pool, &plan.doomed_releases).await?;
    let artist_images = if keep_artist_images {
        Vec::new()
    } else {
        common::images::artist_images(pool, &all_artist_ids).await?
    };

    let mut tx = pool.begin().await?;

    // Unlink first: a release another surviving artist also owns stays, just without these owners.
    sqlx::query(
        r#"DELETE FROM "LocalReleaseArtist"
           WHERE "artistId" = ANY($1::text[]) AND "localReleaseId" = ANY($2::text[])"#,
    )
    .bind(&all_artist_ids)
    .bind(&plan.owned_releases)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"DELETE FROM "MusicBrainzReleaseArtist"
           WHERE "artistId" = ANY($1::text[]) AND "releaseId" = ANY($2::text[])"#,
    )
    .bind(&all_artist_ids)
    .bind(&plan.mb_releases)
    .execute(&mut *tx)
    .await?;

    // Local releases left without an owner (cascades to tracks, credits, favorites, playlists, issues).
    crate::sweep::sweep_orphaned_releases(&mut tx, &plan.owned_releases, &[]).await?;

    if !delete_ids.is_empty() {
        sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
            .bind(&delete_ids)
            .execute(&mut *tx)
            .await?;
    }
    // Surviving credit-only artists no longer own anything here.
    let kept_ids: Vec<String> = all_artist_ids
        .iter()
        .filter(|id| !delete_ids.contains(id))
        .cloned()
        .collect();
    if !kept_ids.is_empty() {
        sqlx::query(
            r#"UPDATE "Artist" SET image = NULL, "imageUrl" = NULL,
                 "totalTracks" = 0, "totalFileSize" = 0, "updatedAt" = NOW()
               WHERE id = ANY($1::text[])"#,
        )
        .bind(&kept_ids)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    common::cleanup::delete_orphaned_mb_releases(
        pool,
        common::cleanup::MbSweepScope::Releases(&plan.mb_releases),
    )
    .await?;

    let (local_r, s3_r) =
        common::images::delete_unreferenced_release_images(pool, config, &release_images).await;
    let (local_a, s3_a) = common::images::delete_artist_image_files(config, &artist_images).await;
    Ok((local_r + local_a, s3_r + s3_a))
}
