// Repair for multi-disc releases that were split across LocalRelease rows.
//
// `LocalRelease.groupKey` is `folder:{folderPath}`, so a release stored as one folder per disc
// became one row per disc, and sync bound every one of them to the same MusicBrainzRelease. Each
// row was then scored against the release's FULL tracklist, so every half read MISSING_TRACKS and
// the downloader kept re-acquiring an album that was already complete on disk.
//
// The index now merges these at scan time (index::db::plan_disc_merges), but a plain `./index`
// skips file paths it already knows, so it never revisits those folders. This pass fixes the rows
// already in the database.
//
// **Metadata decides, never folder names.** Rows merge iff their tracks agree on the majority
// embedded MusicBrainz *release* id and their disc-number sets are disjoint - exactly what MB
// asserts when it calls something one release with several media. Overlapping disc numbers mean two
// rips of the same disc (duplicate copies, left alone for the duplicate-release audit). A box set
// whose discs carry different embedded ids is left alone here too, but NOT because that is correct -
// MusicBrainz has no box-set entity, a box IS one Release with N media (docs/box_sets.md §2) - only
// because this pass can only see embedded ids and MB stores no id-level link from a box's disc to the
// standalone album it duplicates. `boxset::run_repair` is the tier-2 pass that matches by tracklist
// instead and folds those cases afterwards.
//
// Note `--repair-shared-release-ids` cannot do this job: it skips every group whose rows share a
// credited artist (which is all of them), and its remedy - unbinding the loser - would just let the
// half re-bind on the next sync.

use chrono::Utc;
use colored::Colorize;
use common::progress::Reporter;
use sqlx::PgPool;
use std::collections::{BTreeSet, HashMap};

pub struct DiscRow {
    pub local_id: String,
    pub folder_path: Option<String>,
    pub title: String,
    pub majority_mb_release_id: String,
    pub disc_numbers: BTreeSet<i32>,
    pub track_count: i64,
}

pub struct MergePlan {
    pub mb_release_id: String,
    pub survivor: String,
    pub absorbed: Vec<String>,
    pub folder_path: String,
}

#[derive(Default)]
pub struct MultiDiscSummary {
    pub groups_seen: usize,
    pub groups_merged: usize,
    pub groups_skipped_overlapping_discs: usize,
    pub rows_absorbed: usize,
}

/// Longest common ancestor of two folder paths, on `/` boundaries.
fn common_ancestor(a: &str, b: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for (sa, sb) in a.split('/').zip(b.split('/')) {
        if sa != sb {
            break;
        }
        out.push(sa);
    }
    out.join("/")
}

/// Decide, for one set of rows sharing an embedded MB release id, whether they are discs of a
/// single release and which row should absorb the others. `None` when they are not (or when the
/// group is ambiguous, e.g. two rows claiming the same disc).
pub fn plan_group(rows: &[&DiscRow]) -> Option<MergePlan> {
    if rows.len() < 2 {
        return None;
    }
    let mut claims: HashMap<i32, usize> = HashMap::new();
    for r in rows {
        for d in &r.disc_numbers {
            *claims.entry(*d).or_insert(0) += 1;
        }
    }
    // Any contested disc makes the whole group ambiguous: merging the wrong copy would bury a
    // duplicate inside the release, so leave it for the audit rather than guess.
    if claims.values().any(|n| *n > 1) {
        return None;
    }

    let mut ordered: Vec<&&DiscRow> = rows.iter().collect();
    ordered.sort_by(|a, b| {
        a.disc_numbers
            .iter()
            .next()
            .cmp(&b.disc_numbers.iter().next())
            .then(a.local_id.cmp(&b.local_id))
    });

    let survivor = ordered[0];
    let folder_path = ordered
        .iter()
        .filter_map(|r| r.folder_path.clone())
        .reduce(|acc, f| common_ancestor(&acc, &f))
        .filter(|p| !p.is_empty())
        .or_else(|| survivor.folder_path.clone())
        .unwrap_or_default();

    Some(MergePlan {
        mb_release_id: survivor.majority_mb_release_id.clone(),
        survivor: survivor.local_id.clone(),
        absorbed: ordered
            .iter()
            .skip(1)
            .map(|r| r.local_id.clone())
            .collect(),
        folder_path,
    })
}

/// Every LocalRelease whose tracks carry a majority embedded MB release id shared with at least one
/// other row, with the disc numbers those tracks claim.
pub async fn find_candidate_rows(pool: &PgPool) -> Result<Vec<DiscRow>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, String, String, Vec<i32>, i64)> = sqlx::query_as(
        r#"
        WITH per_lr AS (
          SELECT lr.id,
                 lr."folderPath",
                 lr.title,
                 (SELECT t."mbReleaseId"
                    FROM "LocalReleaseTrack" t
                   WHERE t."localReleaseId" = lr.id AND t."mbReleaseId" IS NOT NULL
                   GROUP BY t."mbReleaseId"
                   ORDER BY count(*) DESC, t."mbReleaseId" ASC
                   LIMIT 1) AS majority_mb,
                 (SELECT array_agg(DISTINCT COALESCE(t."discNumber", 1))
                    FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id) AS discs,
                 (SELECT count(*) FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id) AS n
            FROM "LocalRelease" lr
        )
        SELECT id, "folderPath", title, majority_mb, discs, n
          FROM per_lr
         WHERE majority_mb IS NOT NULL
           AND discs IS NOT NULL
           AND majority_mb IN (SELECT majority_mb FROM per_lr WHERE majority_mb IS NOT NULL
                                GROUP BY majority_mb HAVING count(*) > 1)
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(local_id, folder_path, title, majority_mb_release_id, discs, track_count)| DiscRow {
                local_id,
                folder_path,
                title,
                majority_mb_release_id,
                disc_numbers: discs.into_iter().collect(),
                track_count,
            },
        )
        .collect())
}

pub async fn run_repair(
    pool: &PgPool,
    reporter: &Reporter,
    dry_run: bool,
) -> Result<MultiDiscSummary, sqlx::Error> {
    let rows = find_candidate_rows(pool).await?;
    let mut by_release: HashMap<&str, Vec<&DiscRow>> = HashMap::new();
    for r in &rows {
        by_release
            .entry(r.majority_mb_release_id.as_str())
            .or_default()
            .push(r);
    }

    let mut summary = MultiDiscSummary {
        groups_seen: by_release.len(),
        ..Default::default()
    };
    reporter.info(&format!(
        "{} release(s) claimed by more than one local row",
        summary.groups_seen
    ));
    reporter.blank();

    // Deterministic order so a dry run and the real run report identically.
    let mut release_ids: Vec<&str> = by_release.keys().copied().collect();
    release_ids.sort_unstable();

    for release_id in release_ids {
        let group = &by_release[release_id];
        let Some(plan) = plan_group(group) else {
            summary.groups_skipped_overlapping_discs += 1;
            continue;
        };

        println!(
            "{} {} -> {} ({} row(s) absorbed)",
            "▸".cyan(),
            release_id,
            plan.folder_path,
            plan.absorbed.len()
        );
        for r in group {
            let mark = if r.local_id == plan.survivor {
                "KEEP ".green().bold()
            } else {
                "merge".yellow()
            };
            let discs: Vec<String> = r.disc_numbers.iter().map(|d| d.to_string()).collect();
            println!(
                "    {} {} — \"{}\" (disc {}, {} tracks) [{}]",
                mark,
                r.local_id,
                r.title,
                discs.join("+"),
                r.track_count,
                r.folder_path.as_deref().unwrap_or("?")
            );
        }

        summary.groups_merged += 1;
        summary.rows_absorbed += plan.absorbed.len();
        if dry_run {
            continue;
        }

        let now = Utc::now().naive_utc();
        let mut tx = pool.begin().await?;
        sqlx::query(
            r#"UPDATE "LocalReleaseTrack" SET "localReleaseId" = $1, "updatedAt" = $2
               WHERE "localReleaseId" = ANY($3)"#,
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
        // matchStatus UNKNOWN makes the next ./sync re-score the now-complete tracklist.
        sqlx::query(
            r#"UPDATE "LocalRelease"
               SET "groupKey" = $1, "folderPath" = $2, "matchStatus" = 'UNKNOWN', "updatedAt" = $3
               WHERE id = $4"#,
        )
        .bind(format!("mbrelease:{}", plan.mb_release_id))
        .bind(&plan.folder_path)
        .bind(now)
        .bind(&plan.survivor)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, folder: &str, mb: &str, discs: &[i32]) -> DiscRow {
        DiscRow {
            local_id: id.to_string(),
            folder_path: Some(folder.to_string()),
            title: format!("title-{}", id),
            majority_mb_release_id: mb.to_string(),
            disc_numbers: discs.iter().copied().collect(),
            track_count: discs.len() as i64,
        }
    }

    #[test]
    fn merges_disjoint_discs_onto_the_lowest_disc_row() {
        let a = row("cd2", "A/Album/CD 2 (Vol 4)", "mb-x", &[2]);
        let b = row("cd1", "A/Album/CD 1 (Vol 3)", "mb-x", &[1]);

        let plan = plan_group(&[&a, &b]).expect("merges");

        assert_eq!(plan.survivor, "cd1");
        assert_eq!(plan.absorbed, vec!["cd2".to_string()]);
        assert_eq!(plan.folder_path, "A/Album");
    }

    #[test]
    fn refuses_a_group_where_two_rows_claim_one_disc() {
        let a = row("flac", "A/Album [FLAC]", "mb-x", &[1]);
        let b = row("mp3", "A/Album [MP3]", "mb-x", &[1]);

        assert!(plan_group(&[&a, &b]).is_none());
    }

    #[test]
    fn refuses_a_group_where_a_duplicate_contests_one_half() {
        let a = row("cd1", "A/Album/CD1", "mb-x", &[1]);
        let b = row("cd2", "A/Album/CD2", "mb-x", &[2]);
        let dupe = row("copy", "A/Album copy", "mb-x", &[1]);

        assert!(plan_group(&[&a, &b, &dupe]).is_none());
    }

    #[test]
    fn a_single_row_is_never_a_merge() {
        let a = row("solo", "A/Album", "mb-x", &[1]);

        assert!(plan_group(&[&a]).is_none());
    }

    #[test]
    fn falls_back_to_the_survivor_folder_when_rows_share_no_ancestor() {
        let a = row("cd1", "A/Album/CD1", "mb-x", &[1]);
        let b = row("cd2", "B/Elsewhere/CD2", "mb-x", &[2]);

        let plan = plan_group(&[&a, &b]).expect("merges");

        assert_eq!(plan.folder_path, "A/Album/CD1");
    }
}
