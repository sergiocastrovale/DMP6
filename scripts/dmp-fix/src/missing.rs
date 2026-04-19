use colored::Colorize;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagItem};
use sqlx::types::chrono::Utc;
use sqlx::PgPool;
use crate::tags;

pub async fn fix(pool: &PgPool, music_dir: &str) -> Result<(usize, usize), sqlx::Error> {
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
        return Ok((0, 0));
    }

    println!("  Processing {} issues...", rows.len());
    let mut ok = 0usize;
    let mut fail = 0usize;
    let now = Utc::now().naive_utc();

    for (issue_id, file_path, proposed_opt) in &rows {
        let Some(proposed) = proposed_opt else { continue };
        let abs_path = tags::resolve_path(music_dir, file_path);

        match apply_proposed(&abs_path, proposed) {
            Ok(()) => {
                println!("  {} {}", "✓".green(), file_path);
                sqlx::query(
                    r#"UPDATE "IssueMissingMetadata" SET status = 'RESOLVED', "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(issue_id)
                .execute(pool)
                .await?;
                ok += 1;
            }
            Err(e) => {
                println!("  {} {}: {}", "✗".red(), file_path, e);
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

    Ok((ok, fail))
}

fn apply_proposed(abs_path: &std::path::Path, proposed: &serde_json::Value) -> Result<(), String> {
    let mut tagged = Probe::open(abs_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let Some(tag) = tagged.primary_tag_mut() else {
        return Err("No primary tag found".to_string());
    };

    if let Some(v) = proposed.get("albumArtist").and_then(|v| v.as_str()) {
        tag.insert(TagItem::new(ItemKey::AlbumArtist, ItemValue::Text(v.to_string())));
    }
    if let Some(v) = proposed.get("artist").and_then(|v| v.as_str()) {
        tag.set_artist(v.to_string());
    }
    if let Some(v) = proposed.get("album").and_then(|v| v.as_str()) {
        tag.set_album(v.to_string());
    }
    if let Some(v) = proposed.get("year").and_then(|v| v.as_u64()) {
        tag.set_year(v as u32);
    }

    tag.save_to_path(abs_path, lofty::config::WriteOptions::default())
        .map_err(|e| e.to_string())?;

    if let Some(dir) = abs_path.parent() {
        let tmp = dir.join(".dmp-fix-touch");
        if std::fs::File::create(&tmp).is_ok() {
            let _ = std::fs::remove_file(&tmp);
        }
    }

    Ok(())
}
