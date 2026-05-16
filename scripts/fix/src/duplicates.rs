use colored::Colorize;
use common::config::Config;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use crate::tags;

pub async fn fix(pool: &PgPool, config: &Config, music_dir: &str) -> Result<(usize, usize), sqlx::Error> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        r#"SELECT i.id, i."artistAId", a.name, i."artistBId", b.name
           FROM "IssueDuplicateArtist" i
           JOIN "Artist" a ON a.id = i."artistAId"
           JOIN "Artist" b ON b.id = i."artistBId"
           WHERE i.status = 'PENDING'"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        println!("  No PENDING duplicate artist issues.");
        return Ok((0, 0));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let now = Utc::now().naive_utc();

    for (issue_id, artist_a, name_a, artist_b, name_b) in &rows {
        match merge(pool, config, music_dir, artist_a, name_a, artist_b, name_b).await {
            Ok(()) => {
                println!("  {} Merged {} → {}", "✓".green(), name_b, name_a);
                sqlx::query(
                    r#"UPDATE "IssueDuplicateArtist" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                ok += 1;
            }
            Err(e) => {
                println!("  {} Failed to merge {} → {}: {}", "✗".red(), name_b, name_a, e);
                sqlx::query(
                    r#"UPDATE "IssueDuplicateArtist" SET status = 'FAILED', "updatedAt" = $1 WHERE id = $2"#,
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

async fn merge(pool: &PgPool, config: &Config, music_dir: &str, artist_a: &str, name_a: &str, artist_b: &str, name_b: &str) -> Result<(), sqlx::Error> {
    let file_paths: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT t."filePath", t.artist, t."albumArtist"
           FROM "LocalReleaseTrack" t
           JOIN "TrackArtist" ta ON ta."trackId" = t.id
           WHERE ta."artistId" = $1"#,
    )
    .bind(artist_b)
    .fetch_all(pool)
    .await?;

    for (fp, artist_tag, album_artist_tag) in &file_paths {
        let abs_path = tags::resolve_path(music_dir, fp);
        let new_artist = artist_tag.as_deref().unwrap_or(name_b).replace(name_b, name_a);
        let new_album_artist = album_artist_tag.as_deref().unwrap_or(name_b).replace(name_b, name_a);
        if let Err(e) = tags::write_artist_tags(&abs_path, &new_artist, &new_album_artist) {
            println!("  {} {}: {}", "⚠".yellow(), fp, e);
        }
    }

    sqlx::query(
        r#"DELETE FROM "LocalReleaseArtist"
           WHERE "artistId" = $1
             AND "localReleaseId" IN (
               SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $2
             )"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(pool)
    .await?;

    sqlx::query(r#"UPDATE "LocalReleaseArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(pool)
        .await?;

    sqlx::query(
        r#"DELETE FROM "TrackArtist"
           WHERE "artistId" = $1
             AND ("trackId", role) IN (
               SELECT "trackId", role FROM "TrackArtist" WHERE "artistId" = $2
             )"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(pool)
    .await?;

    sqlx::query(r#"UPDATE "TrackArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(pool)
        .await?;

    sqlx::query(
        r#"DELETE FROM "MusicBrainzReleaseArtist"
           WHERE "artistId" = $1
             AND "releaseId" IN (
               SELECT "releaseId" FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $2
             )"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(pool)
    .await?;

    sqlx::query(r#"UPDATE "MusicBrainzReleaseArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(pool)
        .await?;

    // Delete B's image using correct path from config
    let img: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT image FROM "Artist" WHERE id = $1"#,
    )
    .bind(artist_b)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(image_file),)) = img {
        if !image_file.is_empty() {
            crate::tags::delete_artist_image(config, &image_file).await;
        }
    }

    sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#)
        .bind(artist_b)
        .execute(pool)
        .await?;

    Ok(())
}
