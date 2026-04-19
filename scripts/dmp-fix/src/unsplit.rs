use colored::Colorize;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagItem};
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use crate::tags;

pub async fn fix(pool: &PgPool, music_dir: &str) -> Result<(usize, usize), sqlx::Error> {
    let rows: Vec<(String, String, String, Vec<String>)> = sqlx::query_as(
        r#"SELECT i.id, a.id, a.name, i."proposedParts"
           FROM "IssueUnsplitArtist" i
           JOIN "Artist" a ON a.id = i."artistId"
           WHERE i.status = 'PENDING'"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        println!("  No PENDING unsplit artist issues.");
        return Ok((0, 0));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let now = Utc::now().naive_utc();

    for (issue_id, artist_id, compound_name, parts) in &rows {
        // Primary artist = first proposed part (goes into albumArtist / TPE2)
        let primary = parts.first().map(|s| s.as_str()).unwrap_or(compound_name.as_str());
        // Full compound value goes into artist / TPE1 so multi-artist is preserved
        let artist_tag = compound_name.as_str();

        let file_paths: Vec<(String,)> = sqlx::query_as(
            r#"SELECT t."filePath"
               FROM "LocalReleaseTrack" t
               JOIN "TrackArtist" ta ON ta."trackId" = t.id
               WHERE ta."artistId" = $1"#,
        )
        .bind(artist_id)
        .fetch_all(pool)
        .await?;

        let mut any_fail = false;
        for (fp,) in &file_paths {
            let abs_path = tags::resolve_path(music_dir, fp);
            if let Err(e) = write_unsplit_tags(&abs_path, primary, artist_tag) {
                println!("  {} {}: {}", "✗".red(), fp, e);
                any_fail = true;
            }
        }

        let new_status = if any_fail { "FAILED" } else { "RESOLVED" };
        if !any_fail {
            println!("  {} [{}] → albumArtist='{}' artist='{}'", "✓".green(), compound_name, primary, artist_tag);
        }

        sqlx::query(
            r#"UPDATE "IssueUnsplitArtist" SET status = $1, "updatedAt" = $2 WHERE id = $3"#,
        )
        .bind(new_status)
        .bind(now)
        .bind(issue_id)
        .execute(pool)
        .await?;

        if any_fail { fail += 1; } else { ok += 1; }
    }

    Ok((ok, fail))
}

fn write_unsplit_tags(abs_path: &std::path::Path, album_artist: &str, artist: &str) -> Result<(), String> {
    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    if let Some(tag) = tagged.primary_tag_mut() {
        // albumArtist (TPE2) = primary artist only
        tag.insert(TagItem::new(ItemKey::AlbumArtist, ItemValue::Text(album_artist.to_string())));
        // artist (TPE1) = compound value with all contributing artists
        tag.set_artist(artist.to_string());
        tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
            .map_err(|e| e.to_string())?;
    }

    if let Some(dir) = abs_path.parent() {
        let tmp = dir.join(".dmp-fix-touch");
        if std::fs::File::create(&tmp).is_ok() {
            let _ = std::fs::remove_file(&tmp);
        }
    }

    Ok(())
}
