use colored::Colorize;
use common::config::Config;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;

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

    for (issue_id, artist_id, name) in &rows {
        let img: Option<(Option<String>,)> = sqlx::query_as(
            r#"SELECT image FROM "Artist" WHERE id = $1"#,
        )
        .bind(artist_id)
        .fetch_optional(pool)
        .await?;

        if let Some((Some(image_file),)) = img {
            if !image_file.is_empty() {
                crate::tags::delete_artist_image(config, &image_file).await;
            }
        }

        match sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#)
            .bind(artist_id)
            .execute(pool)
            .await
        {
            Ok(_) => {
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
