// One-off repair for audit #24: sync's matcher used to bind an MB releaseId onto a LocalRelease
// without checking whether some OTHER unrelated LocalRelease already claimed it. A forward guard
// (db::find_release_owner, wired into main.rs's per-release sync path) now stops NEW damage, but
// ~13K existing conflicts predate the guard and stay conflicted until this repair unbinds the losers.
//
// Rule for picking a winner per conflicting releaseId (audit's suggested rule):
//   1. Closest track-count match to the MusicBrainzRelease wins (exact match beats partial).
//   2. Tie -> title similarity to the MB release title wins (reuses mb_matching::names_are_similar).
//   3. Tie -> most-recently-synced (updatedAt DESC) wins.
// Losers get releaseId=NULL, matchStatus='UNMATCHED' so they re-match cleanly on the next ./sync.
//
// Skipped entirely: groups where every claimed owner shares at least one credited artist in common
// (e.g. a compilation credited to the same artist via multiple LocalReleaseArtist rows) - that's a
// legitimate multi-row claim, not the bug.

use crate::mb_matching::names_are_similar;
use chrono::NaiveDateTime;
use colored::Colorize;
use common::progress::Reporter;
use sqlx::PgPool;
use std::collections::HashSet;

pub struct ConflictGroup {
    pub release_id: String,
    pub local_ids: Vec<String>,
}

pub struct CandidateRelease {
    pub id: String,
    pub title: String,
    pub folder_path: Option<String>,
    pub track_count: i64,
    pub updated_at: NaiveDateTime,
    pub credited_artist_ids: Vec<String>,
}

pub struct Decision {
    pub winner: String,
    pub losers: Vec<String>,
}

pub async fn find_conflict_groups(pool: &PgPool) -> Result<Vec<ConflictGroup>, sqlx::Error> {
    let rows: Vec<(String, Vec<String>)> = sqlx::query_as(
        r#"SELECT lr."releaseId", array_agg(DISTINCT lr.id)
           FROM "LocalRelease" lr
           WHERE lr."releaseId" IS NOT NULL
           GROUP BY lr."releaseId"
           HAVING count(DISTINCT lr.id) > 1"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(release_id, local_ids)| ConflictGroup {
            release_id,
            local_ids,
        })
        .collect())
}

pub async fn fetch_candidates(
    pool: &PgPool,
    local_ids: &[String],
) -> Result<Vec<CandidateRelease>, sqlx::Error> {
    let mut out = Vec::with_capacity(local_ids.len());
    for id in local_ids {
        let (title, folder_path, updated_at): (String, Option<String>, NaiveDateTime) =
            sqlx::query_as(
                r#"SELECT title, "folderPath", "updatedAt" FROM "LocalRelease" WHERE id = $1"#,
            )
            .bind(id)
            .fetch_one(pool)
            .await?;
        let (track_count,): (i64,) = sqlx::query_as(
            r#"SELECT count(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
        )
        .bind(id)
        .fetch_one(pool)
        .await?;
        let artist_rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT "artistId" FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1"#,
        )
        .bind(id)
        .fetch_all(pool)
        .await?;
        out.push(CandidateRelease {
            id: id.clone(),
            title,
            folder_path,
            track_count,
            updated_at,
            credited_artist_ids: artist_rows.into_iter().map(|(a,)| a).collect(),
        });
    }
    Ok(out)
}

pub async fn fetch_mb_release_info(
    pool: &PgPool,
    release_id: &str,
) -> Result<(String, i64), sqlx::Error> {
    let (title,): (String,) =
        sqlx::query_as(r#"SELECT title FROM "MusicBrainzRelease" WHERE id = $1"#)
            .bind(release_id)
            .fetch_one(pool)
            .await?;
    let (track_count,): (i64,) =
        sqlx::query_as(r#"SELECT count(*) FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#)
            .bind(release_id)
            .fetch_one(pool)
            .await?;
    Ok((title, track_count))
}

/// True when every candidate shares at least one credited artist in common - a legitimate
/// multi-claim (e.g. a compilation credited to the same artist twice), not the bug this repairs.
pub fn shares_common_artist(candidates: &[CandidateRelease]) -> bool {
    let Some(first) = candidates.first() else {
        return false;
    };
    let mut common: HashSet<&str> = first
        .credited_artist_ids
        .iter()
        .map(|s| s.as_str())
        .collect();
    for c in &candidates[1..] {
        let set: HashSet<&str> = c.credited_artist_ids.iter().map(|s| s.as_str()).collect();
        common = common.intersection(&set).copied().collect();
        if common.is_empty() {
            return false;
        }
    }
    !common.is_empty()
}

/// Pure decision logic (no DB) - which candidate wins, and who loses. See module doc for the rule.
pub fn pick_winner(
    mb_title: &str,
    mb_track_count: i64,
    candidates: &[CandidateRelease],
) -> Decision {
    let mut ranked: Vec<&CandidateRelease> = candidates.iter().collect();
    ranked.sort_by(|a, b| {
        let a_diff = (a.track_count - mb_track_count).abs();
        let b_diff = (b.track_count - mb_track_count).abs();
        a_diff
            .cmp(&b_diff)
            .then_with(|| {
                let a_sim = names_are_similar(&a.title, mb_title);
                let b_sim = names_are_similar(&b.title, mb_title);
                b_sim.cmp(&a_sim) // similar (true) sorts before dissimilar (false)
            })
            .then_with(|| b.updated_at.cmp(&a.updated_at)) // more recently synced wins ties
    });
    let winner = ranked[0].id.clone();
    let losers = ranked[1..].iter().map(|c| c.id.clone()).collect();
    Decision { winner, losers }
}

pub struct RepairSummary {
    pub groups_seen: usize,
    pub groups_skipped_shared_artist: usize,
    pub groups_repaired: usize,
    pub rows_unbound: usize,
}

pub async fn run_repair(
    pool: &PgPool,
    reporter: &Reporter,
    dry_run: bool,
) -> Result<RepairSummary, sqlx::Error> {
    let groups = find_conflict_groups(pool).await?;
    reporter.info(&format!("{} conflicting releaseId(s) found", groups.len()));
    reporter.blank();

    let mut summary = RepairSummary {
        groups_seen: groups.len(),
        groups_skipped_shared_artist: 0,
        groups_repaired: 0,
        rows_unbound: 0,
    };

    for group in &groups {
        let candidates = fetch_candidates(pool, &group.local_ids).await?;

        if shares_common_artist(&candidates) {
            summary.groups_skipped_shared_artist += 1;
            continue;
        }

        let (mb_title, mb_track_count) = fetch_mb_release_info(pool, &group.release_id).await?;
        let decision = pick_winner(&mb_title, mb_track_count, &candidates);

        println!(
            "{} releaseId {} (MB: \"{}\", {} tracks)",
            "▸".cyan(),
            group.release_id,
            mb_title,
            mb_track_count
        );
        for c in &candidates {
            let mark = if c.id == decision.winner {
                "WINNER".green().bold()
            } else {
                "loser".red()
            };
            println!(
                "    {} {} — \"{}\" ({} tracks) [{}]",
                mark,
                c.id,
                c.title,
                c.track_count,
                c.folder_path.as_deref().unwrap_or("?")
            );
        }

        if dry_run {
            summary.groups_repaired += 1;
            summary.rows_unbound += decision.losers.len();
            continue;
        }

        let mut tx = pool.begin().await?;
        for loser_id in &decision.losers {
            sqlx::query(
                r#"UPDATE "LocalRelease" SET "releaseId" = NULL, "matchStatus" = 'UNMATCHED', "updatedAt" = NOW() WHERE id = $1"#,
            )
            .bind(loser_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;

        summary.groups_repaired += 1;
        summary.rows_unbound += decision.losers.len();
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(days: i64) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            + chrono::Duration::days(days)
    }

    fn candidate(
        id: &str,
        title: &str,
        track_count: i64,
        updated_days: i64,
        artists: &[&str],
    ) -> CandidateRelease {
        CandidateRelease {
            id: id.to_string(),
            title: title.to_string(),
            folder_path: None,
            track_count,
            updated_at: dt(updated_days),
            credited_artist_ids: artists.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn exact_track_count_match_wins_over_partial() {
        let candidates = vec![
            candidate("a", "Wrong Title", 8, 0, &["x"]),
            candidate("b", "Right Album", 10, 0, &["x"]),
        ];
        let decision = pick_winner("Right Album", 10, &candidates);
        assert_eq!(decision.winner, "b");
        assert_eq!(decision.losers, vec!["a"]);
    }

    #[test]
    fn tied_track_count_falls_back_to_title_similarity() {
        let candidates = vec![
            candidate("a", "Completely Different", 10, 0, &["x"]),
            candidate("b", "The Album Name", 10, 0, &["x"]),
        ];
        let decision = pick_winner("Album Name", 10, &candidates);
        assert_eq!(decision.winner, "b");
    }

    #[test]
    fn tied_track_count_and_title_falls_back_to_most_recently_synced() {
        let candidates = vec![
            candidate("older", "Album", 10, 0, &["x"]),
            candidate("newer", "Album", 10, 5, &["x"]),
        ];
        let decision = pick_winner("Album", 10, &candidates);
        assert_eq!(decision.winner, "newer");
        assert_eq!(decision.losers, vec!["older"]);
    }

    #[test]
    fn shares_common_artist_true_when_all_candidates_share_one() {
        let candidates = vec![
            candidate("a", "Comp Vol 1", 10, 0, &["artist-x", "artist-y"]),
            candidate("b", "Comp Vol 2", 10, 0, &["artist-x", "artist-z"]),
        ];
        assert!(shares_common_artist(&candidates));
    }

    #[test]
    fn shares_common_artist_false_when_no_overlap() {
        let candidates = vec![
            candidate("a", "Album A", 10, 0, &["artist-x"]),
            candidate("b", "Album B", 10, 0, &["artist-y"]),
        ];
        assert!(!shares_common_artist(&candidates));
    }

    #[test]
    fn shares_common_artist_false_for_a_single_empty_list() {
        assert!(!shares_common_artist(&[]));
    }
}
