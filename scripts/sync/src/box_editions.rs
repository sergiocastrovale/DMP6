//! Derives `MusicBrainzReleaseMedium.equivalentReleaseId`/`equivalentReleaseGroupId` - the "this box
//! disc IS that standalone album" link goal 2 of docs/box_sets.md needs, and the one MusicBrainz
//! itself never sends us (§2.2: `inc=release-rels` on a box returns `[]`). Pure SQL + one artist-
//! scoped Rust pass, no MusicBrainz API calls - everything needed already lives in
//! `MusicBrainzReleaseTrack` once media/recordingId are synced (Phase 2).
//!
//! Two passes, run every time:
//!
//!   1. **Exact recording-set equi-join** (SQL): a medium and a single-medium release are the same
//!      thing if their recording-id sets are identical. Cheap and unambiguous, but only fires once a
//!      release has been (re-)synced with `recordingId` populated on every track - which, at initial
//!      rollout, is true for the ~4.6k multi-medium releases just backfilled and false for the ~115k
//!      untouched single-medium releases (docs/box_sets.md Phase 8).
//!   2. **Title+duration fallback** (Rust, artist-scoped): for a medium the exact pass couldn't place,
//!      compare its tracklist (title, duration ±5s - the same tolerance `owned::find_owning_bundle`
//!      uses) against every single-medium release credited to the same artist. Scoped to one artist's
//!      releases specifically so this stays cheap without an index over the whole catalogue - a box
//!      and the standalone album it reprints are essentially always credited to the same artist.

use std::collections::HashMap;

use crate::owned::{durations_compatible, normalize_title};
use common::progress::Reporter;
use sqlx::PgPool;

#[derive(Default)]
pub struct LinkSummary {
    pub exact_linked: u64,
    pub fallback_candidates: usize,
    pub fallback_linked: usize,
    pub fallback_ambiguous: usize,
}

/// Step 1: exact recording-set equi-join, pure SQL. A medium's fingerprint is `md5` of its sorted,
/// deduplicated recording ids; a release's is the same computed over its own (single-medium)
/// tracklist. Requires every track on both sides to carry a `recordingId` and at least 3 of them -
/// `owned::MIN_CLAIMABLE_TRACKS`'s reasoning applies equally here: a one- or two-track match is much
/// more likely to be coincidence than a genuine shared recording set.
///
/// A fingerprint claimed by more than one single-medium release (a genuine recording-set collision)
/// updates the medium once per match in an arbitrary order - vanishingly rare for a 3+-track set, and
/// not worth a dedicated ambiguity guard the way the Rust fallback below has one.
pub async fn link_by_recording_fingerprint(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH medium_fp AS (
          SELECT m.id AS medium_id,
                 md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
          FROM "MusicBrainzReleaseMedium" m
          JOIN "MusicBrainzReleaseTrack" t
            ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
          GROUP BY m.id
          HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0 AND count(*) >= 3
        ), release_fp AS (
          SELECT r.id AS release_id, r."releaseGroupId",
                 md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
          FROM "MusicBrainzRelease" r
          JOIN "MusicBrainzReleaseTrack" t ON t."releaseId" = r.id
          WHERE r."mediumCount" = 1
          GROUP BY r.id
          HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0 AND count(*) >= 3
        )
        UPDATE "MusicBrainzReleaseMedium" m
        SET "recordingFingerprint" = mf.fp,
            "equivalentReleaseId" = rf.release_id,
            "equivalentReleaseGroupId" = rf."releaseGroupId",
            "updatedAt" = now()
        FROM medium_fp mf
        JOIN release_fp rf ON rf.fp = mf.fp
        WHERE m.id = mf.medium_id
        "#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

struct UnlinkedMedium {
    medium_id: String,
    release_id: String,
    tracks: Vec<(String, Option<i32>)>,
}

struct ReleaseFacts {
    release_id: String,
    release_group_id: Option<String>,
    tracks: Vec<(String, Option<i32>)>,
}

async fn unlinked_media(pool: &PgPool) -> Result<Vec<UnlinkedMedium>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<i32>, i32)> = sqlx::query_as(
        r#"SELECT m.id, m."releaseId", t.title, t."durationMs", t.position
           FROM "MusicBrainzReleaseMedium" m
           JOIN "MusicBrainzReleaseTrack" t
             ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
           WHERE m."equivalentReleaseId" IS NULL
           ORDER BY m.id, t.position"#,
    )
    .fetch_all(pool)
    .await?;

    let mut media: Vec<UnlinkedMedium> = Vec::new();
    for (medium_id, release_id, title, duration_ms, _pos) in rows {
        let secs = duration_ms.map(|ms| ms / 1000);
        match media.last_mut() {
            Some(m) if m.medium_id == medium_id => m.tracks.push((title, secs)),
            _ => media.push(UnlinkedMedium {
                medium_id,
                release_id,
                tracks: vec![(title, secs)],
            }),
        }
    }
    Ok(media)
}

async fn artist_ids_for_release(pool: &PgPool, release_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "artistId" FROM "MusicBrainzReleaseArtist" WHERE "releaseId" = $1"#,
    )
    .bind(release_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Every single-medium release credited to any of `artist_ids` - the candidate pool a box's medium
/// is compared against. Scoped to these artists specifically so this stays a handful of releases per
/// lookup rather than a query over the whole catalogue.
async fn single_medium_releases_for_artists(
    pool: &PgPool,
    artist_ids: &[String],
) -> Result<Vec<ReleaseFacts>, sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String, Option<String>, String, Option<i32>, i32)> = sqlx::query_as(
        r#"SELECT DISTINCT r.id, r."releaseGroupId", t.title, t."durationMs", t.position
           FROM "MusicBrainzRelease" r
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = r.id
           JOIN "MusicBrainzReleaseTrack" t ON t."releaseId" = r.id
           WHERE mra."artistId" = ANY($1) AND r."mediumCount" = 1
           ORDER BY r.id, t.position"#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await?;

    let mut releases: Vec<ReleaseFacts> = Vec::new();
    for (release_id, rg_id, title, duration_ms, _pos) in rows {
        let secs = duration_ms.map(|ms| ms / 1000);
        match releases.last_mut() {
            Some(r) if r.release_id == release_id => r.tracks.push((title, secs)),
            _ => releases.push(ReleaseFacts {
                release_id,
                release_group_id: rg_id,
                tracks: vec![(title, secs)],
            }),
        }
    }
    Ok(releases)
}

fn tracks_match(medium: &[(String, Option<i32>)], release: &[(String, Option<i32>)]) -> bool {
    if medium.len() != release.len() || medium.len() < 3 {
        return false;
    }
    medium.iter().zip(release.iter()).all(|((mt, ms), (rt, rs))| {
        normalize_title(mt) == normalize_title(rt) && durations_compatible(*ms, *rs)
    })
}

pub async fn run_link_box_editions(
    pool: &PgPool,
    reporter: &Reporter,
    dry_run: bool,
) -> Result<LinkSummary, sqlx::Error> {
    let mut summary = LinkSummary::default();

    if dry_run {
        // The exact pass is a single idempotent UPDATE with no destructive side effect worth
        // previewing separately - report how many rows it WOULD touch by running it read-only via a
        // COUNT of the same join instead of executing the UPDATE.
        let (count,): (i64,) = sqlx::query_as(
            r#"
            WITH medium_fp AS (
              SELECT m.id AS medium_id,
                     md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
              FROM "MusicBrainzReleaseMedium" m
              JOIN "MusicBrainzReleaseTrack" t
                ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
              GROUP BY m.id
              HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0 AND count(*) >= 3
            ), release_fp AS (
              SELECT r.id AS release_id,
                     md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
              FROM "MusicBrainzRelease" r
              JOIN "MusicBrainzReleaseTrack" t ON t."releaseId" = r.id
              WHERE r."mediumCount" = 1
              GROUP BY r.id
              HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0 AND count(*) >= 3
            )
            SELECT count(*) FROM medium_fp mf JOIN release_fp rf ON rf.fp = mf.fp
            "#,
        )
        .fetch_one(pool)
        .await?;
        summary.exact_linked = count.max(0) as u64;
    } else {
        summary.exact_linked = link_by_recording_fingerprint(pool).await?;
    }
    reporter.info(&format!(
        "Exact recording-set match: {} medium/medium(s) {}",
        summary.exact_linked,
        if dry_run { "would link" } else { "linked" }
    ));

    let media = unlinked_media(pool).await?;
    summary.fallback_candidates = media.len();
    reporter.info(&format!(
        "{} medium(s) still unlinked - trying title+duration fallback",
        media.len()
    ));

    let mut releases_by_artist_key: HashMap<String, Vec<ReleaseFacts>> = HashMap::new();
    for m in &media {
        let artist_ids = artist_ids_for_release(pool, &m.release_id).await?;
        if artist_ids.is_empty() {
            continue;
        }
        let mut sorted_ids = artist_ids.clone();
        sorted_ids.sort_unstable();
        let cache_key = sorted_ids.join(",");
        if !releases_by_artist_key.contains_key(&cache_key) {
            let facts = single_medium_releases_for_artists(pool, &artist_ids).await?;
            releases_by_artist_key.insert(cache_key.clone(), facts);
        }
        let candidates = &releases_by_artist_key[&cache_key];

        let hits: Vec<&ReleaseFacts> = candidates
            .iter()
            .filter(|r| tracks_match(&m.tracks, &r.tracks))
            .collect();
        let [hit] = hits[..] else {
            if hits.len() > 1 {
                summary.fallback_ambiguous += 1;
            }
            continue;
        };

        summary.fallback_linked += 1;
        if dry_run {
            continue;
        }
        sqlx::query(
            r#"UPDATE "MusicBrainzReleaseMedium"
               SET "equivalentReleaseId" = $1, "equivalentReleaseGroupId" = $2, "updatedAt" = now()
               WHERE id = $3"#,
        )
        .bind(&hit.release_id)
        .bind(&hit.release_group_id)
        .bind(&m.medium_id)
        .execute(pool)
        .await?;
    }

    reporter.info(&format!(
        "Fallback match: {} linked, {} ambiguous (left unset)",
        summary.fallback_linked, summary.fallback_ambiguous
    ));

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(title: &str, secs: Option<i32>) -> (String, Option<i32>) {
        (title.to_string(), secs)
    }

    #[test]
    fn matches_identical_tracklists_within_duration_tolerance() {
        let medium = vec![t("Ring Ring", Some(185)), t("Waterloo", Some(180)), t("ABBA", Some(200))];
        let release = vec![t("ring ring", Some(186)), t("Waterloo", Some(183)), t("A.B.B.A.", Some(198))];
        assert!(tracks_match(&medium, &release));
    }

    #[test]
    fn refuses_a_track_count_mismatch() {
        let medium = vec![t("A", Some(100)), t("B", Some(100))];
        let release = vec![t("A", Some(100)), t("B", Some(100)), t("C", Some(100))];
        assert!(!tracks_match(&medium, &release));
    }

    #[test]
    fn refuses_a_duration_outlier_past_tolerance() {
        // Same title, e.g. a live re-recording under a shared name - the duration gap is the tell.
        let medium = vec![t("A", Some(100)), t("B", Some(100)), t("C", Some(100))];
        let release = vec![t("A", Some(100)), t("B", Some(140)), t("C", Some(100))];
        assert!(!tracks_match(&medium, &release));
    }

    #[test]
    fn refuses_fewer_than_three_tracks_even_if_they_match() {
        let medium = vec![t("A", Some(100)), t("B", Some(100))];
        let release = vec![t("A", Some(100)), t("B", Some(100))];
        assert!(!tracks_match(&medium, &release));
    }
}
