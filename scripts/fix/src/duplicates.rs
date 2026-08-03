use crate::{folder_from_path, tags};
use colored::Colorize;
use common::artists::replace_artist_word;
use common::config::Config;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;

pub async fn fix(
    pool: &PgPool,
    config: &Config,
    music_dir: &str,
) -> Result<(usize, usize, HashSet<String>), sqlx::Error> {
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
        return Ok((0, 0, HashSet::new()));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut artists: HashSet<String> = HashSet::new();
    let now = Utc::now().naive_utc();

    for (issue_id, artist_a, name_a, artist_b, name_b) in &rows {
        match merge(pool, config, music_dir, artist_a, name_a, artist_b, name_b).await {
            Ok(affected) => {
                println!("  {} Merged {} → {}", "✓".green(), name_b, name_a);
                sqlx::query(
                    r#"UPDATE "IssueDuplicateArtist" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                artists.extend(affected);
                ok += 1;
            }
            Err(e) => {
                println!(
                    "  {} Failed to merge {} → {}: {}",
                    "✗".red(),
                    name_b,
                    name_a,
                    e
                );
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

    Ok((ok, fail, artists))
}

async fn merge(
    pool: &PgPool,
    config: &Config,
    music_dir: &str,
    artist_a: &str,
    name_a: &str,
    artist_b: &str,
    name_b: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    let file_paths: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT DISTINCT t."filePath", t.artist, t."albumArtist"
           FROM "LocalReleaseTrack" t
           LEFT JOIN "LocalRelease" lr ON t."localReleaseId" = lr.id
           LEFT JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id AND lra."artistId" = $1
           LEFT JOIN "TrackRelatedArtist" tra ON tra."trackId" = t.id AND tra."artistId" = $1
           WHERE lra.id IS NOT NULL OR tra.id IS NOT NULL"#,
    )
    .bind(artist_b)
    .fetch_all(pool)
    .await?;

    let mut affected: HashSet<String> = HashSet::new();
    for (fp, artist_tag, album_artist_tag) in &file_paths {
        let abs_path = tags::resolve_path(music_dir, fp);
        // Whole-word, case-insensitive replace - a naive substring replace corrupts an unrelated tag
        // that merely contains name_b as a substring (e.g. merging "Muse" would mangle "Amused"), and
        // case-sensitivity alone would miss "MUSE"/"muse" tag variants entirely.
        let new_artist = match artist_tag.as_deref() {
            Some(t) => replace_artist_word(t, name_b, name_a),
            None => name_a.to_string(),
        };
        let new_album_artist = match album_artist_tag.as_deref() {
            Some(t) => replace_artist_word(t, name_b, name_a),
            None => name_a.to_string(),
        };
        if let Err(e) = tags::write_artist_tags(&abs_path, &new_artist, &new_album_artist) {
            println!("  {} {}: {}", "⚠".yellow(), fp, e);
        } else if let Some(a) = folder_from_path(fp) {
            affected.insert(a);
        }
    }

    // Fetch B's image path before B disappears (used for a best-effort file delete after commit).
    let img: Option<(Option<String>,)> =
        sqlx::query_as(r#"SELECT image FROM "Artist" WHERE id = $1"#)
            .bind(artist_b)
            .fetch_optional(pool)
            .await?;

    // Everything below is one atomic merge - a crash mid-way must not leave B half-merged (double
    // work on re-run) or drop B's genres/URLs/play count/in-flight downloads on the floor.
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"DELETE FROM "LocalReleaseArtist"
           WHERE "artistId" = $1
             AND "localReleaseId" IN (
               SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $2
             )"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(&mut *tx)
    .await?;

    sqlx::query(r#"UPDATE "LocalReleaseArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        r#"DELETE FROM "TrackRelatedArtist"
           WHERE "artistId" = $1
             AND "trackId" IN (
               SELECT "trackId" FROM "TrackRelatedArtist" WHERE "artistId" = $2
             )"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(&mut *tx)
    .await?;

    sqlx::query(r#"UPDATE "TrackRelatedArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
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
    .execute(&mut *tx)
    .await?;

    sqlx::query(r#"UPDATE "MusicBrainzReleaseArtist" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    // Genres: union B's into A. Implicit join table, composite PK ("A","B") - drop what A already
    // has before retargeting, or the UPDATE would hit a PK conflict.
    sqlx::query(
        r#"DELETE FROM "_ArtistGenres"
           WHERE "A" = $1
             AND "B" IN (SELECT "B" FROM "_ArtistGenres" WHERE "A" = $2)"#,
    )
    .bind(artist_b)
    .bind(artist_a)
    .execute(&mut *tx)
    .await?;
    sqlx::query(r#"UPDATE "_ArtistGenres" SET "A" = $1 WHERE "A" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    // URLs: union B's into A. Unique on (artistId, type, url) - same dedup-then-retarget dance.
    sqlx::query(
        r#"DELETE FROM "ArtistUrl" au
           WHERE au."artistId" = $1
             AND EXISTS (
               SELECT 1 FROM "ArtistUrl" other
               WHERE other."artistId" = $2 AND other.type = au.type AND other.url = au.url
             )"#,
    )
    .bind(artist_b)
    .bind(artist_a)
    .execute(&mut *tx)
    .await?;
    sqlx::query(r#"UPDATE "ArtistUrl" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    // In-flight/queued downloads: retarget instead of letting the FK's SetNull orphan them into
    // "missing artist" failures once B is deleted below.
    sqlx::query(r#"UPDATE "DownloadedRelease" SET "artistId" = $1 WHERE "artistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    // Play count: fold B's history into A before B disappears, instead of silently losing it.
    sqlx::query(
        r#"UPDATE "Artist" SET "totalPlayCount" = "totalPlayCount" + (
             SELECT "totalPlayCount" FROM "Artist" WHERE id = $2
           ) WHERE id = $1"#,
    )
    .bind(artist_a)
    .bind(artist_b)
    .execute(&mut *tx)
    .await?;

    sqlx::query(r#"UPDATE "Artist" SET "primaryArtistId" = $1 WHERE "primaryArtistId" = $2"#)
        .bind(artist_a)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#)
        .bind(artist_b)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    // Image file delete is a best-effort side effect on disk/S3, not part of the atomic DB merge.
    if let Some((Some(image_file),)) = img {
        if !image_file.is_empty() {
            crate::tags::delete_artist_image(config, &image_file).await;
        }
    }

    Ok(affected)
}
