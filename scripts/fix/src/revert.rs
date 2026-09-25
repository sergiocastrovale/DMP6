use crate::{folder_from_path, tags, RevertMode};
use common::progress::Reporter;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;

pub async fn revert(
    pool: &PgPool,
    music_dir: &str,
    issue_type: &str,
    mode: RevertMode,
    reporter: &Reporter,
) -> Result<(usize, usize, HashSet<String>), sqlx::Error> {
    let issue_table = match issue_type {
        "corrupted" => "IssueCorruptedTpe2",
        "missing" => "IssueMissingMetadata",
        _ => {
            reporter.warn(&format!("Revert not supported for type: {}", issue_type));
            return Ok((0, 0, HashSet::new()));
        }
    };

    let target_status = match mode {
        RevertMode::Undo => "DETECTED",
        RevertMode::UndoResolved => "RESOLVED",
    };

    let issue_ids: Vec<(String,)> = sqlx::query_as(&format!(
        r#"SELECT id FROM "{}" WHERE status = 'PENDING_REVERT'::"IssueStatus""#,
        issue_table
    ))
    .fetch_all(pool)
    .await?;

    if issue_ids.is_empty() {
        reporter.skip(&format!("No PENDING_REVERT {} issues.", issue_type));
        return Ok((0, 0, HashSet::new()));
    }

    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut artists: HashSet<String> = HashSet::new();
    let now = Utc::now().naive_utc();
    let mut current_folder = String::new();

    for (issue_id,) in &issue_ids {
        let history_rows: Vec<(String, String, serde_json::Value)> = sqlx::query_as(
            r#"SELECT id, "filePath", "previousState"
               FROM "FixHistory"
               WHERE "issueId" = $1 AND "revertedAt" IS NULL
               ORDER BY "appliedAt" DESC"#,
        )
        .bind(issue_id)
        .fetch_all(pool)
        .await?;

        if history_rows.is_empty() {
            reporter.warn(&format!(
                "No fix history for issue {}",
                issue_id.get(..8).unwrap_or(issue_id)
            ));
            sqlx::query(&format!(
                r#"UPDATE "{}" SET status = $1::"IssueStatus", "updatedAt" = $2 WHERE id = $3"#,
                issue_table
            ))
            .bind(target_status)
            .bind(now)
            .bind(issue_id)
            .execute(pool)
            .await?;
            ok += 1;
            continue;
        }

        let mut any_fail = false;
        for (fh_id, file_path, previous_state) in &history_rows {
            let folder = file_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            if folder != current_folder {
                current_folder = folder.to_string();
                reporter.step(&format!("Reverting {}...", folder));
            }

            let abs_path = tags::resolve_path(music_dir, file_path);
            let file_name = file_path
                .rsplit_once('/')
                .map(|(_, f)| f)
                .unwrap_or(file_path);

            if !abs_path.exists() {
                reporter.nested().warn(&format!("not found: {}", file_name));
                any_fail = true;
                continue;
            }

            match tags::write_tags_from_json(&abs_path, previous_state) {
                Ok(()) => {
                    reporter.nested().ok(file_name);
                    sqlx::query(
                        r#"UPDATE "FixHistory" SET "revertedAt" = $1, "updatedAt" = $1 WHERE id = $2"#,
                    )
                    .bind(now)
                    .bind(fh_id)
                    .execute(pool)
                    .await?;

                    if let Some(a) = folder_from_path(file_path) {
                        artists.insert(a);
                    }
                }
                Err(e) => {
                    reporter.nested().warn(&format!("{}: {}", file_name, e));
                    any_fail = true;
                }
            }
        }

        let final_status = if any_fail { "FAILED" } else { target_status };
        sqlx::query(&format!(
            r#"UPDATE "{}" SET status = $1::"IssueStatus", "updatedAt" = $2 WHERE id = $3"#,
            issue_table
        ))
        .bind(final_status)
        .bind(now)
        .bind(issue_id)
        .execute(pool)
        .await?;

        if any_fail {
            fail += 1;
        } else {
            ok += 1;
        }
    }

    Ok((ok, fail, artists))
}
