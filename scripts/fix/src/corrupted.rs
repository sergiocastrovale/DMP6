use crate::{folder_from_path, tags};
use colored::Colorize;
use serde_json::json;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;

pub async fn fix(
    pool: &PgPool,
    music_dir: &str,
) -> Result<(usize, usize, HashSet<String>), sqlx::Error> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT i.id, i."proposedValue", t."filePath", t."albumArtist"
           FROM "IssueCorruptedTpe2" i
           JOIN "LocalReleaseTrack" t ON t.id = i."trackId"
           WHERE i.status = 'PENDING'"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        println!("  No PENDING corrupted TPE2 issues.");
        return Ok((0, 0, HashSet::new()));
    }

    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut artists: HashSet<String> = HashSet::new();
    let now = Utc::now().naive_utc();
    let mut current_folder = String::new();

    for (issue_id, proposed, file_path, current) in &rows {
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

        let previous_state =
            tags::read_tags(&abs_path).unwrap_or_else(|_| json!({ "albumArtist": current }));

        match tags::write_album_artist(&abs_path, proposed) {
            Ok(()) => {
                println!("    {} {} → {}", "✓".green(), file_name, proposed);

                let fh_id = cuid2::create_id();
                sqlx::query(
                    r#"INSERT INTO "FixHistory" (id, "issueType", "issueId", "filePath", "previousState", "appliedState", "appliedAt", "createdAt", "updatedAt")
                       VALUES ($1, 'corrupted', $2, $3, $4, $5, $6, $6, $6)"#,
                )
                .bind(&fh_id)
                .bind(issue_id)
                .bind(file_path)
                .bind(&previous_state)
                .bind(json!({ "albumArtist": proposed }))
                .bind(now)
                .execute(pool)
                .await?;

                sqlx::query(
                    r#"UPDATE "IssueCorruptedTpe2" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;

                if let Some(a) = folder_from_path(file_path) {
                    artists.insert(a);
                }
                ok += 1;
            }
            Err(e) => {
                println!("    {} {}: {}", "✗".red(), file_name, e);
                sqlx::query(
                    r#"UPDATE "IssueCorruptedTpe2" SET status = 'FAILED', "updatedAt" = $1 WHERE id = $2"#,
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
