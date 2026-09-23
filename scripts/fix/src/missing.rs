use crate::{folder_from_path, tags};
use colored::Colorize;
use serde_json::json;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;

pub async fn fix(
    pool: &PgPool,
    music_dir: &str,
    dry_run: bool,
) -> Result<(usize, usize, HashSet<String>), sqlx::Error> {
    let rows: Vec<(String, String, Option<serde_json::Value>)> = sqlx::query_as(
        r#"SELECT i.id, t."filePath", i."proposedValues"
           FROM "IssueMissingMetadata" i
           JOIN "LocalReleaseTrack" t ON t.id = i."trackId"
           WHERE i.status = 'PENDING'
             AND i."proposedValues" IS NOT NULL"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        println!("  No PENDING missing metadata issues with proposed values.");
        return Ok((0, 0, HashSet::new()));
    }

    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut artists: HashSet<String> = HashSet::new();
    let now = Utc::now().naive_utc();
    let mut current_folder = String::new();

    for (issue_id, file_path, proposed_opt) in &rows {
        let Some(proposed) = proposed_opt else {
            continue;
        };

        let folder = file_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        if folder != current_folder {
            current_folder = folder.to_string();
            println!("  Processing {}...", folder);
        }

        let abs_path = tags::resolve_path(music_dir, file_path);
        let file_name = file_path
            .rsplit_once('/')
            .map(|(_, f)| f)
            .unwrap_or(file_path);

        if dry_run {
            println!("  {} {}: {}", "[dry-run]".cyan(), file_name, proposed);
            ok += 1;
            continue;
        }

        let previous_state = tags::read_tags(&abs_path).unwrap_or_else(|_| json!({}));

        // Same ordering as corrupted::fix: the revert record is committed only alongside the write
        // that made it true, never before.
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                println!("    {} {}: {}", "✗".red(), file_name, e);
                fail += 1;
                continue;
            }
        };
        let fh_id = cuid2::create_id();
        if let Err(e) = sqlx::query(
            r#"INSERT INTO "FixHistory" (id, "issueType", "issueId", "filePath", "previousState", "appliedState", "appliedAt", "createdAt", "updatedAt")
               VALUES ($1, 'missing', $2, $3, $4, $5, $6, $6, $6)"#,
        )
        .bind(&fh_id)
        .bind(issue_id)
        .bind(file_path)
        .bind(&previous_state)
        .bind(proposed)
        .bind(now)
        .execute(&mut *tx)
        .await
        {
            println!("    {} {}: {}", "✗".red(), file_name, e);
            fail += 1;
            continue;
        }
        if let Err(e) = sqlx::query(
            r#"UPDATE "IssueMissingMetadata" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
        )
        .bind(now)
        .bind(issue_id)
        .execute(&mut *tx)
        .await
        {
            println!("    {} {}: {}", "✗".red(), file_name, e);
            fail += 1;
            continue;
        }

        match tags::write_tags_from_json(&abs_path, proposed) {
            Ok(()) => {
                if let Err(e) = tx.commit().await {
                    println!("    {} {}: {}", "✗".red(), file_name, e);
                    fail += 1;
                    continue;
                }
                println!("    {} {}", "✓".green(), file_name);
                if let Some(a) = folder_from_path(file_path) {
                    artists.insert(a);
                }
                ok += 1;
            }
            Err(e) => {
                tx.rollback().await.ok();
                println!("    {} {}: {}", "✗".red(), file_name, e);
                sqlx::query(
                    r#"UPDATE "IssueMissingMetadata" SET status = 'FAILED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                fail += 1;
            }
        }
    }

    Ok((ok, fail, artists))
}
