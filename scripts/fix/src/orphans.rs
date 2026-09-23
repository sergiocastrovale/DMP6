use colored::Colorize;
use common::cleanup::ARTIST_UNLINKED;
use common::config::Config;
use common::images::{artist_images, delete_artist_image_files};
use sqlx::types::chrono::Utc;
use sqlx::PgPool;

/// Deletes the artists of PENDING orphan issues - but only those still linked to nothing at the
/// moment of deletion. An issue whose artist gained a link since the audit is stale and is dropped.
pub async fn fix(pool: &PgPool, config: &Config) -> Result<(usize, usize), sqlx::Error> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT i.id, i."artistId", a.name
           FROM "IssueOrphanArtist" i
           JOIN "Artist" a ON a.id = i."artistId"
           WHERE i.status = 'PENDING'"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        println!("  No PENDING orphan artist issues.");
        return Ok((0, 0));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let now = Utc::now().naive_utc();
    let delete_unlinked =
        format!(r#"DELETE FROM "Artist" a WHERE a.id = $1 AND {ARTIST_UNLINKED}"#);

    for (issue_id, artist_id, name) in &rows {
        let images = artist_images(pool, std::slice::from_ref(artist_id)).await?;
        match sqlx::query(&delete_unlinked)
            .bind(artist_id)
            .execute(pool)
            .await
        {
            Ok(r) if r.rows_affected() == 1 => {
                delete_artist_image_files(config, &images).await;
                println!("  {} Deleted orphan: {}", "✓".green(), name);
                sqlx::query(
                    r#"UPDATE "IssueOrphanArtist" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                ok += 1;
            }
            Ok(_) => {
                println!(
                    "  {} {} is no longer an orphan - issue dropped",
                    "⚠".yellow(),
                    name
                );
                sqlx::query(r#"DELETE FROM "IssueOrphanArtist" WHERE id = $1"#)
                    .bind(issue_id)
                    .execute(pool)
                    .await?;
            }
            Err(e) => {
                println!("  {} Failed to delete {}: {}", "✗".red(), name, e);
                sqlx::query(
                    r#"UPDATE "IssueOrphanArtist" SET status = 'FAILED', "updatedAt" = $1 WHERE id = $2"#,
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
