use colored::Colorize;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use crate::tags;

pub async fn fix(pool: &PgPool, music_dir: &str) -> Result<(usize, usize), sqlx::Error> {
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
        return Ok((0, 0));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let now = Utc::now().naive_utc();

    for (issue_id, proposed, file_path, current) in &rows {
        let abs_path = tags::resolve_path(music_dir, file_path);
        match tags::write_album_artist(&abs_path, proposed) {
            Ok(()) => {
                println!("  {} {} → {}", "✓".green(), file_path, proposed);
                sqlx::query(
                    r#"UPDATE "IssueCorruptedTpe2" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                ok += 1;
            }
            Err(e) => {
                println!("  {} {} ({}): {}", "✗".red(), file_path, current, e);
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

    Ok((ok, fail))
}
