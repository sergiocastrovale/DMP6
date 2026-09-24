use super::*;
use sqlx::PgPool;

// ---------------------------------------------------------------------------
// Tidy: DB-only re-score of a box-touched release
// ---------------------------------------------------------------------------

/// A `LocalRelease` tidy's box pass touched (or left `UNKNOWN` from a prior interrupted run, or whose
/// track links point at the wrong release) and must re-score.
pub struct RescoreTarget {
    pub local_release_id: String,
    pub mb_release_id: String,
    pub medium_position: Option<i32>,
    pub year: Option<i32>,
    /// Picked up only because its tracks link outside its own release, not because anything this run
    /// touched it. Counted separately so the repair is measurable.
    pub stale_links_only: bool,
    /// Its stored status was `MISSING_TRACKS` - so a `COMPLETE` re-score is a scorer improvement taking
    /// effect, which `tidy --rescore-only` reports on its own line.
    pub was_missing_tracks: bool,
}

/// Targets, unioned from three sources:
///
///   1. every scoped `LocalRelease` already sitting at `matchStatus='UNKNOWN'` with a release bound (a
///      prior run's box pass that never got tidied, or index's own UNKNOWN-on-track-delete);
///   2. `touched_ids` - this run's own fold/dissolve output. Almost always a subset of (1) already, but
///      a defensive union costs nothing and guarantees this run's own work is never skipped;
///   3. any scoped release holding a `LocalReleaseTrack.mbTrackId` that belongs to a **different**
///      release than the one the folder is bound to.
///
/// Source 3 exists because (1) and (2) between them cannot see a disc a box pass dissolved before this
/// source existed: `apply_dissolve` only sets `UNKNOWN` when something changed, so a disc already moved
/// and already scored is at neither `UNKNOWN` nor in `touched_ids`, and its tracks keep pointing at the
/// box's track rows forever (docs/specs/spec_tidy_observations.md). `rescore_bound_release` already
/// repairs this correctly - it just never saw them without this source. DB-only, no MusicBrainz call,
/// and `mbTrackId` is indexed.
pub async fn get_rescore_targets(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    touched_ids: &[String],
    include_missing_tracks: bool,
) -> Result<Vec<RescoreTarget>, sqlx::Error> {
    let mut ids: Vec<String> = match scope {
        Some(artist_ids) => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                   WHERE lr."matchStatus" = 'UNKNOWN' AND lr."releaseId" IS NOT NULL
                     -- A no-guessing consensus reason (docs/no_guessing.md) always ships with
                     -- releaseId IS NULL, so this is already implied - explicit so --rescore-only
                     -- --all can never resurrect a terminal row even if that invariant ever slips.
                     AND lr."statusReason" IS NULL
                     AND lra."artistId" = ANY($1)"#,
            )
            .bind(artist_ids)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_scalar(
                r#"SELECT id FROM "LocalRelease"
                   WHERE "matchStatus" = 'UNKNOWN' AND "releaseId" IS NOT NULL AND "statusReason" IS NULL"#,
            )
            .fetch_all(pool)
            .await?
        }
    };
    let unknown_or_touched: std::collections::HashSet<String> = ids
        .iter()
        .cloned()
        .chain(touched_ids.iter().cloned())
        .collect();
    for id in touched_ids {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }

    let stale: Vec<String> = match scope {
        Some(artist_ids) => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                   JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lr.id
                   JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
                   WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId"
                     AND lra."artistId" = ANY($1)"#,
            )
            .bind(artist_ids)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_scalar(
                r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                   JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lr.id
                   JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
                   WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId""#,
            )
            .fetch_all(pool)
            .await?
        }
    };
    for id in &stale {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }

    // `tidy --rescore-only`: releases already scored `MISSING_TRACKS`, so a change to the scorer's own
    // rules reaches the releases it was made for. Nothing else re-scores a release once it has a
    // status - sync only revisits what it re-matches.
    if include_missing_tracks {
        let missing: Vec<String> = match scope {
            Some(artist_ids) => {
                sqlx::query_scalar(
                    r#"SELECT DISTINCT lr.id FROM "LocalRelease" lr
                       JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                       WHERE lr."matchStatus" = 'MISSING_TRACKS' AND lr."releaseId" IS NOT NULL
                         AND lra."artistId" = ANY($1)"#,
                )
                .bind(artist_ids)
                .fetch_all(pool)
                .await?
            }
            None => {
                sqlx::query_scalar(
                    r#"SELECT id FROM "LocalRelease"
                       WHERE "matchStatus" = 'MISSING_TRACKS' AND "releaseId" IS NOT NULL"#,
                )
                .fetch_all(pool)
                .await?
            }
        };
        let known: std::collections::HashSet<String> = ids.iter().cloned().collect();
        ids.extend(missing.into_iter().filter(|id| !known.contains(id)));
    }

    if ids.is_empty() {
        return Ok(Vec::new());
    }

    #[derive(sqlx::FromRow)]
    struct RescoreCandidateRow {
        id: String,
        #[sqlx(rename = "releaseId")]
        release_id: Option<String>,
        #[sqlx(rename = "mediumPosition")]
        medium_position: Option<i32>,
        year: Option<i32>,
        status: String,
    }

    let stale: std::collections::HashSet<String> = stale.into_iter().collect();
    let rows: Vec<RescoreCandidateRow> = sqlx::query_as(
        r#"SELECT id, "releaseId", "mediumPosition", year, "matchStatus"::text AS status
           FROM "LocalRelease" WHERE id = ANY($1) AND "releaseId" IS NOT NULL"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let stale_links_only = stale.contains(&r.id) && !unknown_or_touched.contains(&r.id);
            Some(RescoreTarget {
                local_release_id: r.id,
                mb_release_id: r.release_id?,
                medium_position: r.medium_position,
                year: r.year,
                stale_links_only,
                was_missing_tracks: r.status == "MISSING_TRACKS",
            })
        })
        .collect())
}

/// Outcome of a DB-only re-score: `Scored` on a normal write, `Deferred` when there is nothing to
/// score against yet (no local tracks, or the bound MB release has none) - left at `UNKNOWN`, which
/// keeps it in `get_artists_pending_sync`'s watermark clause so a plain sync's normal per-release path
/// picks it up and re-fetches it from MusicBrainz.
pub enum RescoreOutcome {
    Scored(&'static str),
    Deferred,
}

/// Re-score one already-bound `LocalRelease` against the `MusicBrainzRelease` it already points at -
/// no MusicBrainz call, no allow-list gate (it is bound already), no tag write (the next sync's
/// `write_mb_ids` owns tags), and never `update_artist_sync_stats` (tidy must never stamp
/// `lastSyncedAt` - see docs/specs/spec_tidy_script.md "Watermark traps").
pub async fn rescore_bound_release(
    pool: &PgPool,
    target: &RescoreTarget,
) -> Result<RescoreOutcome, sqlx::Error> {
    let local_tracks = get_local_tracks_for_release(pool, &target.local_release_id).await?;
    if local_tracks.is_empty() {
        return Ok(RescoreOutcome::Deferred);
    }
    let local_track_ids: Vec<String> = local_tracks.iter().map(|t| t.id.clone()).collect();
    let local_metas = crate::status::track_metas_from_rows(&local_tracks);
    let local_meta_refs: Vec<&common::types::TrackMeta> = local_metas.iter().collect();

    let Some((mb_release, mb_tracks, _mb_id)) =
        load_mb_release_with_tracks(pool, &target.mb_release_id).await?
    else {
        return Ok(RescoreOutcome::Deferred);
    };

    let status_check = crate::status::check_release_status(
        &local_meta_refs,
        &local_track_ids,
        &[(mb_release, mb_tracks)],
        target.year,
        target.medium_position,
    );

    let track_id_rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "musicbrainzId" FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(&target.mb_release_id)
    .fetch_all(pool)
    .await?;

    let track_links: Vec<(String, String)> = status_check
        .matched_mb_tracks
        .iter()
        .filter_map(|(mb_track, local_id_opt)| {
            let local_id = local_id_opt.as_ref()?;
            let db_id = track_id_rows
                .iter()
                .find(|(_, mid)| mid.as_deref() == Some(mb_track.id.as_str()))
                .map(|(db_id, _)| db_id.clone())?;
            Some((local_id.clone(), db_id))
        })
        .collect();
    let status_str = crate::status::status_to_db_string(&status_check.status);
    bind_local_release(
        pool,
        &target.local_release_id,
        &target.mb_release_id,
        status_str,
        &track_links,
    )
    .await?;

    Ok(RescoreOutcome::Scored(status_str))
}
