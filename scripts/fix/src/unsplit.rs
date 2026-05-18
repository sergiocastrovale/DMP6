use std::collections::HashSet;
use colored::Colorize;
use serde_json::json;
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use crate::{folder_from_path, tags};

pub async fn fix(pool: &PgPool, music_dir: &str) -> Result<(usize, usize, HashSet<String>), sqlx::Error> {
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
        return Ok((0, 0, HashSet::new()));
    }

    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut artists: HashSet<String> = HashSet::new();
    let now = Utc::now().naive_utc();

    for (issue_id, artist_id, compound_name, parts) in &rows {
        let artist_tag = compound_name.as_str();

        let file_paths: Vec<(String,)> = sqlx::query_as(
            r#"SELECT t."filePath"
               FROM "LocalReleaseTrack" t
               JOIN "LocalRelease" lr ON t."localReleaseId" = lr.id
               JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
               WHERE lra."artistId" = $1"#,
        )
        .bind(artist_id)
        .fetch_all(pool)
        .await?;

        let folder = file_paths.first()
            .and_then(|(fp,)| fp.rsplit_once('/').map(|(dir, _)| dir))
            .unwrap_or("");
        let artist_folder = file_paths.first()
            .and_then(|(fp,)| fp.split('/').next())
            .unwrap_or("");
        let primary = parts.iter()
            .find(|p| p.eq_ignore_ascii_case(artist_folder))
            .map(|s| s.as_str())
            .unwrap_or_else(|| parts.first().map(|s| s.as_str()).unwrap_or(compound_name.as_str()));

        println!("  Processing {}...", folder);
        let mut any_fail = false;
        for (fp,) in &file_paths {
            let abs_path = tags::resolve_path(music_dir, fp);
            let file_name = fp.rsplit_once('/').map(|(_, f)| f).unwrap_or(fp);

            let previous_state = tags::read_tags(&abs_path)
                .unwrap_or_else(|_| json!({ "artist": compound_name, "albumArtist": compound_name }));

            match tags::write_artist_tags(&abs_path, artist_tag, primary) {
                Ok(()) => {
                    println!("    {} {}", "✓".green(), file_name);
                    let fh_id = cuid2::create_id();
                    sqlx::query(
                        r#"INSERT INTO "FixHistory" (id, "issueType", "issueId", "filePath", "previousState", "appliedState", "appliedAt", "createdAt", "updatedAt")
                           VALUES ($1, 'unsplit', $2, $3, $4, $5, $6, $6, $6)"#,
                    )
                    .bind(&fh_id)
                    .bind(issue_id)
                    .bind(fp)
                    .bind(&previous_state)
                    .bind(json!({ "artist": artist_tag, "albumArtist": primary }))
                    .bind(now)
                    .execute(pool)
                    .await?;

                    if let Some(a) = folder_from_path(fp) {
                        artists.insert(a);
                    }
                }
                Err(e) => {
                    println!("    {} {}: {}", "✗".red(), file_name, e);
                    any_fail = true;
                }
            }
        }

        let new_status = if any_fail { "FAILED" } else { "RESOLVED" };
        if !any_fail {
            println!("  {} albumArtist='{}' artist='{}'", "✓".green(), primary, artist_tag);
        }

        sqlx::query(
            r#"UPDATE "IssueUnsplitArtist" SET status = $1::"IssueStatus", "updatedAt" = $2 WHERE id = $3"#,
        )
        .bind(new_status)
        .bind(now)
        .bind(issue_id)
        .execute(pool)
        .await?;

        if any_fail { fail += 1; } else { ok += 1; }
    }

    Ok((ok, fail, artists))
}
