//! Derives `MusicBrainzReleaseMedium.equivalentReleaseId`/`equivalentReleaseGroupId`/
//! `equivalentMediumPosition` - the "this box disc IS that standalone release" link MusicBrainz
//! itself never sends us (docs/sync_decisions.md: `inc=release-rels` on a box returns `[]`). Pure SQL
//! + two artist-scoped Rust passes, no MusicBrainz API calls - everything needed already lives in
//! `MusicBrainzReleaseTrack` once media/recordingId are synced.
//!
//! Three tiers, run every time, each only attempted on what the previous left unlinked:
//!
//!   1. **Exact recording-set equi-join** (SQL): a medium and a release's medium are the same thing
//!      if their recording-id sets are identical - target can be single- or multi-medium (a box can
//!      reprint another multi-disc compilation's own editions). No minimum track count: exact
//!      recording-MBID equality has no coincidence risk at any count, unlike tiers 2/3 below.
//!   2. **Title+duration fallback** (Rust, artist-scoped): for a medium the exact pass couldn't place,
//!      compare its tracklist (title, duration ±5s) *positionally* against every single-medium
//!      release credited to the same artist - same length required.
//!   3. **Containment match** (Rust, artist-scoped): for a medium still unlinked whose own title is
//!      non-empty, search same-artist releases by loose (substring) title match and confirm via
//!      `owned::find_owning_bundle`'s containment check - closes the common case where the box uses a
//!      bonus-track edition MB hasn't also catalogued as a standalone release under the same track
//!      count, which tiers 1-2's exact-length matching can never see.

use std::collections::HashMap;

use crate::owned::{durations_compatible, normalize_title};
use common::progress::Reporter;
use sqlx::PgPool;

#[derive(Default)]
pub struct LinkSummary {
    pub dangling_cleared: u64,
    pub exact_linked: u64,
    pub fallback_candidates: usize,
    pub fallback_linked: usize,
    pub fallback_ambiguous: usize,
    pub containment_candidates: usize,
    pub containment_linked: usize,
    pub containment_ambiguous: usize,
}

/// Step 0: clear an `equivalentReleaseId` (and its `equivalentReleaseGroupId`/
/// `equivalentMediumPosition` companions) that points at a `MusicBrainzRelease` row that no longer
/// exists. The column carries no foreign key, and the orphan-release sweep
/// (`db::delete_orphaned_mb_releases`) has no reason to know this column exists, so a dissolved box's
/// target deleted for an unrelated reason (a merge, a bad match undone) leaves the equivalence dangling
/// forever - the tiers below only ever fill a `NULL`, never correct a stale value. Left dangling, it
/// also fails the whole repair pass outright: `apply_dissolve` writes it straight into
/// `LocalRelease.releaseId`, which has a real foreign key (docs/sync_decisions.md §9 "One box never
/// blocks the rest" - this is the 2026-09-10 rollout's own abort).
pub async fn clear_dangling_equivalences(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "MusicBrainzReleaseMedium" m
           SET "equivalentReleaseId" = NULL, "equivalentReleaseGroupId" = NULL,
               "equivalentMediumPosition" = NULL, "updatedAt" = now()
           WHERE m."equivalentReleaseId" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzRelease" r WHERE r.id = m."equivalentReleaseId")"#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Step 1: exact recording-set equi-join, pure SQL.
///
/// Source side: media of a box (`parent.mediumCount > 1`). Target side: **any** release's medium,
/// single- or multi-medium (docs/sync_decisions.md - a box can reprint another multi-disc compilation's
/// own editions; restricting the target to single-medium releases misses that entirely). A medium's
/// fingerprint is `md5` of its sorted, deduplicated recording ids; matching a source medium's
/// fingerprint against a target medium's identifies the reprint regardless of how either release is
/// split into discs. `equivalentMediumPosition` records which of the target's media it is - `NULL`
/// when the target is single-medium (the common case).
///
/// No minimum track count on either side. Unlike the title+duration fallback below (where a short
/// coincidental match is a real risk), this is exact recording-MBID equality - a match at any track
/// count, including 1-2, is a certain identity, never a coincidence. A floor here previously made
/// every "singles box" (2-track-per-disc reissues) permanently undissolvable.
///
/// A fingerprint claimed by more than one target medium (a genuine recording-set collision, common
/// for a heavily-reissued artist) is resolved deterministically - lowest MusicBrainz id wins - rather
/// than whatever order Postgres happens to return.
pub async fn link_by_recording_fingerprint(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH source_fp AS (
          SELECT m.id AS medium_id,
                 md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
          FROM "MusicBrainzReleaseMedium" m
          JOIN "MusicBrainzRelease" parent ON parent.id = m."releaseId"
          JOIN "MusicBrainzReleaseTrack" t
            ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
          WHERE parent."mediumCount" > 1
          GROUP BY m.id
          HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0
        ),
        target_fp AS (
          SELECT m.id AS target_medium_id, m."releaseId" AS release_id, m.position AS target_position,
                 r."releaseGroupId" AS release_group_id, r."musicbrainzId" AS musicbrainz_id,
                 r."mediumCount" AS target_medium_count,
                 md5(string_agg(DISTINCT t."recordingId", ',' ORDER BY t."recordingId")) AS fp
          FROM "MusicBrainzReleaseMedium" m
          JOIN "MusicBrainzRelease" r ON r.id = m."releaseId"
          JOIN "MusicBrainzReleaseTrack" t
            ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
          GROUP BY m.id, r.id
          HAVING count(*) FILTER (WHERE t."recordingId" IS NULL) = 0
        ),
        matched AS (
          SELECT sf.medium_id, sf.fp, tf.release_id, tf.release_group_id, tf.target_position,
                 tf.target_medium_count,
                 row_number() OVER (PARTITION BY sf.medium_id ORDER BY tf.musicbrainz_id ASC) AS rn
          FROM source_fp sf
          JOIN target_fp tf ON tf.fp = sf.fp
          JOIN "MusicBrainzReleaseMedium" src ON src.id = sf.medium_id
          WHERE tf.release_id <> src."releaseId"
        )
        UPDATE "MusicBrainzReleaseMedium" m
        SET "recordingFingerprint" = matched.fp,
            "equivalentReleaseId" = matched.release_id,
            "equivalentReleaseGroupId" = matched.release_group_id,
            "equivalentMediumPosition" = CASE WHEN matched.target_medium_count > 1
              THEN matched.target_position ELSE NULL END,
            "updatedAt" = now()
        FROM matched
        WHERE m.id = matched.medium_id AND matched.rn = 1
        "#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

struct UnlinkedMedium {
    medium_id: String,
    release_id: String,
    /// The medium's own title, if MB sent one. `None`/empty for a chronological "complete
    /// sessions"-style box with no per-disc titles - tier 3 skips those outright (docs/sync_decisions.md
    /// §5, §10 limitation 4): nothing to narrow the candidate search against.
    medium_title: Option<String>,
    tracks: Vec<(String, Option<i32>)>,
}

struct ReleaseFacts {
    release_id: String,
    release_group_id: Option<String>,
    tracks: Vec<(String, Option<i32>)>,
}

async fn unlinked_media(pool: &PgPool) -> Result<Vec<UnlinkedMedium>, sqlx::Error> {
    let rows: Vec<(String, String, Option<String>, String, Option<i32>, i32)> = sqlx::query_as(
        r#"SELECT m.id, m."releaseId", m.title, t.title, t."durationMs", t.position
           FROM "MusicBrainzReleaseMedium" m
           JOIN "MusicBrainzReleaseTrack" t
             ON t."releaseId" = m."releaseId" AND t."discNumber" = m.position
           WHERE m."equivalentReleaseId" IS NULL
           ORDER BY m.id, t.position"#,
    )
    .fetch_all(pool)
    .await?;

    let mut media: Vec<UnlinkedMedium> = Vec::new();
    for (medium_id, release_id, medium_title, title, duration_ms, _pos) in rows {
        let secs = duration_ms.map(|ms| ms / 1000);
        match media.last_mut() {
            Some(m) if m.medium_id == medium_id => m.tracks.push((title, secs)),
            _ => media.push(UnlinkedMedium {
                medium_id,
                release_id,
                medium_title,
                tracks: vec![(title, secs)],
            }),
        }
    }
    Ok(media)
}

async fn artist_ids_for_release(
    pool: &PgPool,
    release_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
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

/// `same_release_group_winner` for tier 2's candidate type. Same rule, same determinism.
fn same_release_group_facts_winner<'a>(hits: &[&'a ReleaseFacts]) -> Option<&'a ReleaseFacts> {
    let first = hits.first()?.release_group_id.as_deref()?;
    if !hits
        .iter()
        .all(|r| r.release_group_id.as_deref() == Some(first))
    {
        return None;
    }
    hits.iter()
        .min_by(|a, b| a.release_id.cmp(&b.release_id))
        .copied()
}

fn tracks_match(medium: &[(String, Option<i32>)], release: &[(String, Option<i32>)]) -> bool {
    if medium.len() != release.len() || medium.len() < 3 {
        return false;
    }
    medium
        .iter()
        .zip(release.iter())
        .all(|((mt, ms), (rt, rs))| {
            normalize_title(mt) == normalize_title(rt) && durations_compatible(*ms, *rs)
        })
}

// ---------------------------------------------------------------------------
// Tier 3: containment match (docs/sync_decisions.md)
// ---------------------------------------------------------------------------
//
// Tiers 1-2 both require *equality*: the medium's whole tracklist must match a candidate's whole
// tracklist. That fails whenever the box uses a bonus-track edition MB hasn't also catalogued as a
// standalone release under the exact same track count - the common case for most artists, not an
// edge case (ABBA's own catalogue only avoids it by having 25 editions of some albums). This tier
// finds the base album inside a superset medium instead of requiring an exact-length match.

struct ContainmentCandidate {
    release_id: String,
    release_group_id: Option<String>,
    title: String,
    /// releaseGroupSecondaryTypes = [] - an "original work," the tie-break preference when more than
    /// one candidate satisfies containment (e.g. three same-titled release-groups, only one real).
    is_original_work: bool,
    tracks: Vec<(String, Option<i32>)>,
}

/// Every release credited to any of `artist_ids`, title + full tracklist + secondary-types flag.
/// Deliberately not restricted to single-medium releases: `owned::find_owning_bundle`'s own strict-
/// superset rule (the medium must have MORE tracks than the candidate) already excludes a
/// multi-medium candidate from ever satisfying containment against one disc in practice.
async fn releases_for_artists(
    pool: &PgPool,
    artist_ids: &[String],
) -> Result<Vec<ContainmentCandidate>, sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String, Option<String>, String, bool, String, Option<i32>)> = sqlx::query_as(
        r#"SELECT r.id, r."releaseGroupId", r.title,
                  cardinality(r."releaseGroupSecondaryTypes") = 0,
                  t.title, t."durationMs"
           FROM "MusicBrainzRelease" r
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = r.id
           JOIN "MusicBrainzReleaseTrack" t ON t."releaseId" = r.id
           WHERE mra."artistId" = ANY($1)
           ORDER BY r.id, t."discNumber" NULLS FIRST, t.position"#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await?;

    let mut releases: Vec<ContainmentCandidate> = Vec::new();
    for (release_id, rg_id, title, is_original_work, track_title, duration_ms) in rows {
        let secs = duration_ms.map(|ms| ms / 1000);
        match releases.last_mut() {
            Some(r) if r.release_id == release_id => r.tracks.push((track_title, secs)),
            _ => releases.push(ContainmentCandidate {
                release_id,
                release_group_id: rg_id,
                title,
                is_original_work,
                tracks: vec![(track_title, secs)],
            }),
        }
    }
    Ok(releases)
}

/// Substring containment either direction on `normalize_title`'s output - never equality. Confirmed
/// necessary against two independent real cases: `"ABBA – The Album LP"` vs. the canonical
/// `"The Album"`, and `"David Bowie a.k.a. Space Oddity"` vs. the canonical `"Space Oddity"` - both
/// are containment, neither is equality. This only narrows the candidate pool; the acceptance test is
/// `owned::find_owning_bundle`'s track containment below, never the title.
fn title_loosely_matches(medium_title: &str, candidate_title: &str) -> bool {
    let a = normalize_title(medium_title);
    let b = normalize_title(candidate_title);
    !a.is_empty() && !b.is_empty() && (a.contains(&b) || b.contains(&a))
}

enum ContainmentOutcome<'a> {
    Linked(&'a ContainmentCandidate),
    /// >1 candidate satisfied containment and the `is_original_work` tie-break didn't resolve to
    /// exactly one - left unset rather than guessed.
    Ambiguous,
    None,
}

/// Pure decision fn, split from the DB fetch above exactly as `boxset::plan_box_bind` splits from
/// `boxset::run_repair` - title-narrow, confirm via containment, tie-break. No I/O, so this is the
/// unit-testable core of tier 3; the surrounding loop in `run_link_box_editions` only does DB fetch
/// and the final UPDATE.
fn resolve_containment_winner<'a>(
    medium_title: &str,
    medium_tracks: &[(String, Option<i32>)],
    medium_release_id: &str,
    candidates: &'a [ContainmentCandidate],
) -> ContainmentOutcome<'a> {
    let bundle = crate::owned::LocalBundle {
        release_id: String::new(),
        title: medium_title.to_string(),
        tracks: medium_tracks
            .iter()
            .map(|(title, secs)| (String::new(), title.clone(), *secs))
            .collect(),
    };

    let hits: Vec<&ContainmentCandidate> = candidates
        .iter()
        .filter(|c| c.release_id != medium_release_id)
        .filter(|c| title_loosely_matches(medium_title, &c.title))
        .filter(|c| {
            crate::owned::find_owning_bundle(&c.tracks, std::slice::from_ref(&bundle)).is_some()
        })
        .collect();

    match hits[..] {
        [hit] => ContainmentOutcome::Linked(hit),
        [] => ContainmentOutcome::None,
        _ => {
            let originals: Vec<&&ContainmentCandidate> =
                hits.iter().filter(|c| c.is_original_work).collect();
            match originals[..] {
                [only] => ContainmentOutcome::Linked(*only),
                _ => match same_release_group_winner(&hits) {
                    Some(hit) => ContainmentOutcome::Linked(hit),
                    None => ContainmentOutcome::Ambiguous,
                },
            }
        }
    }
}

/// The tie-break of last resort: when every remaining candidate belongs to the **same release group**,
/// they are editions of one album and the choice between them does not change what the medium is
/// equivalent *to*. Ownership (docs/sync_decisions.md §11) and the missing-albums list both work at
/// release-group level, so refusing here bought nothing and cost real placements - ABBA's box disc 4
/// had four `Arrival` candidates, all release group `e464e167-…`, and stayed unlinked because none of
/// them could be preferred over the others.
///
/// Deliberately requires a known group on every candidate: two `NULL`s are not evidence of sameness.
/// Lowest `release_id` wins, so repeated runs give the same answer (docs/sync_decisions.md §14).
fn same_release_group_winner<'a>(
    hits: &[&'a ContainmentCandidate],
) -> Option<&'a ContainmentCandidate> {
    let first = hits.first()?.release_group_id.as_deref()?;
    if !hits
        .iter()
        .all(|c| c.release_group_id.as_deref() == Some(first))
    {
        return None;
    }
    hits.iter()
        .min_by(|a, b| a.release_id.cmp(&b.release_id))
        .copied()
}

/// Runs all three tiers to completion, no preview mode - called automatically at the tail of a
/// normal sync run, scoped to the artists it touched, never as a user-facing flag (docs/sync_decisions.md
/// §12). The user's explicit call: no dry-run anywhere in this rollout, `./backup` is the recovery
/// path instead.
pub async fn run_link_box_editions(
    pool: &PgPool,
    reporter: &Reporter,
) -> Result<LinkSummary, sqlx::Error> {
    let mut summary = LinkSummary::default();

    summary.dangling_cleared = clear_dangling_equivalences(pool).await?;
    if summary.dangling_cleared > 0 {
        reporter.info(&format!(
            "Cleared {} dangling equivalence(s) (target release no longer exists)",
            summary.dangling_cleared
        ));
    }

    summary.exact_linked = link_by_recording_fingerprint(pool).await?;
    reporter.info(&format!(
        "Exact recording-set match: {} medium/medium(s) linked",
        summary.exact_linked
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
        // Same rule as tier 3's `same_release_group_winner`: several editions of one release group are
        // interchangeable as an equivalence target, so that is a tie worth breaking rather than an
        // ambiguity worth refusing.
        let hit = match hits[..] {
            [only] => only,
            [] => continue,
            _ => match same_release_group_facts_winner(&hits) {
                Some(hit) => hit,
                None => {
                    summary.fallback_ambiguous += 1;
                    continue;
                }
            },
        };

        summary.fallback_linked += 1;
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

    // Tier 3: containment (docs/sync_decisions.md). Re-fetch what tiers 1-2 above still left unlinked.
    let still_unlinked = unlinked_media(pool).await?;
    summary.containment_candidates = still_unlinked
        .iter()
        .filter(|m| {
            m.medium_title
                .as_deref()
                .is_some_and(|t| !t.trim().is_empty())
        })
        .count();
    reporter.info(&format!(
        "{} medium(s) still unlinked with a title - trying containment match",
        summary.containment_candidates
    ));

    let mut containment_by_artist_key: HashMap<String, Vec<ContainmentCandidate>> = HashMap::new();
    for m in &still_unlinked {
        let Some(medium_title) = m.medium_title.as_deref().filter(|t| !t.trim().is_empty()) else {
            continue;
        };
        let artist_ids = artist_ids_for_release(pool, &m.release_id).await?;
        if artist_ids.is_empty() {
            continue;
        }
        let mut sorted_ids = artist_ids.clone();
        sorted_ids.sort_unstable();
        let cache_key = sorted_ids.join(",");
        if !containment_by_artist_key.contains_key(&cache_key) {
            let facts = releases_for_artists(pool, &artist_ids).await?;
            containment_by_artist_key.insert(cache_key.clone(), facts);
        }
        let candidates = &containment_by_artist_key[&cache_key];

        let winner =
            match resolve_containment_winner(medium_title, &m.tracks, &m.release_id, candidates) {
                ContainmentOutcome::Linked(hit) => hit,
                ContainmentOutcome::Ambiguous => {
                    summary.containment_ambiguous += 1;
                    continue;
                }
                ContainmentOutcome::None => continue,
            };

        summary.containment_linked += 1;
        sqlx::query(
            r#"UPDATE "MusicBrainzReleaseMedium"
               SET "equivalentReleaseId" = $1, "equivalentReleaseGroupId" = $2, "updatedAt" = now()
               WHERE id = $3"#,
        )
        .bind(&winner.release_id)
        .bind(&winner.release_group_id)
        .bind(&m.medium_id)
        .execute(pool)
        .await?;
    }

    reporter.info(&format!(
        "Containment match: {} linked, {} ambiguous (left unset)",
        summary.containment_linked, summary.containment_ambiguous
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
        let medium = vec![
            t("Ring Ring", Some(185)),
            t("Waterloo", Some(180)),
            t("ABBA", Some(200)),
        ];
        let release = vec![
            t("ring ring", Some(186)),
            t("Waterloo", Some(183)),
            t("A.B.B.A.", Some(198)),
        ];
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

    // -----------------------------------------------------------------------
    // Tier 3: containment (resolve_containment_winner)
    // -----------------------------------------------------------------------

    fn candidate(
        release_id: &str,
        title: &str,
        is_original_work: bool,
        tracks: &[(&str, i32)],
    ) -> ContainmentCandidate {
        ContainmentCandidate {
            release_id: release_id.to_string(),
            release_group_id: Some(format!("rg-{release_id}")),
            title: title.to_string(),
            is_original_work,
            tracks: tracks
                .iter()
                .map(|(title, secs)| (title.to_string(), Some(*secs)))
                .collect(),
        }
    }

    #[test]
    fn title_containment_is_substring_either_direction_not_equality() {
        // Real case: "ABBA – The Album LP" vs. the canonical "The Album".
        assert!(title_loosely_matches("ABBA – The Album LP", "The Album"));
        assert!(title_loosely_matches("The Album", "ABBA – The Album LP"));
        // Real case: "David Bowie a.k.a. Space Oddity" vs. the canonical "Space Oddity".
        assert!(title_loosely_matches(
            "David Bowie a.k.a. Space Oddity",
            "Space Oddity"
        ));
        assert!(!title_loosely_matches("The Album", "Waterloo"));
    }

    #[test]
    fn title_containment_never_matches_on_empty_strings() {
        assert!(!title_loosely_matches("", "Waterloo"));
        assert!(!title_loosely_matches("Waterloo", ""));
    }

    #[test]
    fn finds_a_bonus_track_medium_base_album_via_containment() {
        // "4 Original Albums"-shaped: the medium is a 4-track bonus-loaded "Ring Ring LP", the
        // candidate is the plain 3-track album - a strict subset, not an exact-length match.
        let medium_tracks = vec![
            t("Ring Ring", Some(185)),
            t("Another Town, Another Train", Some(180)),
            t("Disillusion", Some(200)),
            t("Bonus Remix", Some(210)),
        ];
        let candidates = vec![candidate(
            "ringring1",
            "Ring Ring",
            true,
            &[
                ("Ring Ring", 186),
                ("Another Town, Another Train", 181),
                ("Disillusion", 199),
            ],
        )];
        match resolve_containment_winner("ABBA – Ring Ring LP", &medium_tracks, "box1", &candidates)
        {
            ContainmentOutcome::Linked(hit) => assert_eq!(hit.release_id, "ringring1"),
            _ => panic!("expected a containment match"),
        }
    }

    #[test]
    fn never_matches_a_medium_against_a_sibling_of_the_same_release() {
        // A box's own other discs must never be offered as "equivalent" to one of its own media.
        let medium_tracks = vec![t("A", Some(100)), t("B", Some(100)), t("C", Some(100))];
        let candidates = vec![candidate(
            "box1",
            "Sibling Disc",
            true,
            &[("A", 100), ("B", 100)],
        )];
        assert!(matches!(
            resolve_containment_winner("Sibling Disc", &medium_tracks, "box1", &candidates),
            ContainmentOutcome::None
        ));
    }

    #[test]
    fn ambiguous_containment_tie_breaks_on_original_work() {
        // Three same-titled candidates satisfy containment; only one is an "original work" (empty
        // releaseGroupSecondaryTypes) - the ABBA "three release-groups titled ABBA" shape.
        let medium_tracks = vec![
            t("X", Some(100)),
            t("Y", Some(100)),
            t("Z", Some(100)),
            t("Bonus", Some(100)),
        ];
        let candidates = vec![
            candidate(
                "comp1",
                "ABBA",
                false,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "album1",
                "ABBA",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "comp2",
                "ABBA",
                false,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
        ];
        match resolve_containment_winner("ABBA", &medium_tracks, "box1", &candidates) {
            ContainmentOutcome::Linked(hit) => assert_eq!(hit.release_id, "album1"),
            _ => panic!("expected the original-work tie-break to resolve to album1"),
        }
    }

    #[test]
    fn ambiguous_containment_left_unset_when_the_tie_break_cannot_resolve_it() {
        // Two candidates, both (or neither) "original work" - genuinely ambiguous, left unset rather
        // than guessed (the MB-side cataloguing-duplicate "Kind of Blue" shape).
        let medium_tracks = vec![
            t("X", Some(100)),
            t("Y", Some(100)),
            t("Z", Some(100)),
            t("Bonus", Some(100)),
        ];
        let candidates = vec![
            candidate(
                "kob1",
                "Kind of Blue",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "kob2",
                "Kind of Blue",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
        ];
        assert!(matches!(
            resolve_containment_winner("Kind of Blue", &medium_tracks, "box1", &candidates),
            ContainmentOutcome::Ambiguous
        ));
    }

    /// Several editions of one release group are interchangeable as an equivalence target - ownership
    /// and the missing-albums list both work at release-group level - so this is a tie to break, not an
    /// ambiguity to refuse. ABBA's box disc 4 had four `Arrival` candidates in one group and stayed
    /// unlinked for exactly this reason.
    #[test]
    fn candidates_sharing_one_release_group_break_the_tie_deterministically() {
        let medium_tracks = vec![
            t("X", Some(100)),
            t("Y", Some(100)),
            t("Z", Some(100)),
            t("Bonus", Some(100)),
        ];
        let mut candidates = vec![
            candidate(
                "arrival2",
                "Arrival",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "arrival1",
                "Arrival",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "arrival3",
                "Arrival",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
        ];
        for c in &mut candidates {
            c.release_group_id = Some("rg-arrival".to_string());
        }
        match resolve_containment_winner("Arrival", &medium_tracks, "box1", &candidates) {
            ContainmentOutcome::Linked(hit) => assert_eq!(
                hit.release_id, "arrival1",
                "lowest release id wins, so repeated runs agree"
            ),
            _ => panic!("one release group is a tie, not an ambiguity"),
        }
    }

    /// ...and two genuinely different release groups still refuse. Two NULL groups are not evidence of
    /// sameness either.
    #[test]
    fn candidates_from_two_release_groups_are_still_ambiguous() {
        let medium_tracks = vec![
            t("X", Some(100)),
            t("Y", Some(100)),
            t("Z", Some(100)),
            t("Bonus", Some(100)),
        ];
        let candidates = vec![
            candidate(
                "kob1",
                "Kind of Blue",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
            candidate(
                "kob2",
                "Kind of Blue",
                true,
                &[("X", 100), ("Y", 100), ("Z", 100)],
            ),
        ];
        assert!(matches!(
            resolve_containment_winner("Kind of Blue", &medium_tracks, "box1", &candidates),
            ContainmentOutcome::Ambiguous
        ));

        let mut unknown_groups = candidates;
        for c in &mut unknown_groups {
            c.release_group_id = None;
        }
        assert!(matches!(
            resolve_containment_winner("Kind of Blue", &medium_tracks, "box1", &unknown_groups),
            ContainmentOutcome::Ambiguous
        ));
    }

    #[test]
    fn no_candidate_satisfies_containment_leaves_medium_unlinked() {
        let medium_tracks = vec![t("X", Some(100)), t("Y", Some(100)), t("Z", Some(100))];
        let candidates = vec![candidate(
            "other",
            "Something Else",
            true,
            &[("Q", 100), ("R", 100)],
        )];
        assert!(matches!(
            resolve_containment_winner("Rarities", &medium_tracks, "box1", &candidates),
            ContainmentOutcome::None
        ));
    }
}
