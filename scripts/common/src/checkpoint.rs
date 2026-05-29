use serde_json::Value as JsonValue;
use sqlx::PgPool;

// ---------------------------------------------------------------------------
// Index checkpoint - lastIndexedFolder
// ---------------------------------------------------------------------------

pub async fn save_index_checkpoint(pool: &PgPool, folder: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastIndexedFolder" = $1, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .bind(folder)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_index_checkpoint(pool: &PgPool) -> Option<String> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT "lastIndexedFolder" FROM "Statistics" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await
    .ok()?;
    row?.0
}

pub async fn clear_index_checkpoint(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastIndexedFolder" = NULL, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Sync checkpoint - lastSyncedArtist + lastSyncArgs
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
pub struct SyncCheckpoint {
    pub last_artist: Option<String>,
    pub from: String,
    pub to: String,
    pub only: String,
}

pub async fn save_sync_checkpoint(pool: &PgPool, artist: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastSyncedArtist" = $1, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .bind(artist)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn save_sync_args(pool: &PgPool, from: &str, to: &str, only: &str) -> Result<(), sqlx::Error> {
    let json = serde_json::json!({ "from": from, "to": to, "only": only });
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastSyncArgs" = $1, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .bind(json)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_sync_checkpoint(pool: &PgPool) -> Option<SyncCheckpoint> {
    let row: Option<(Option<String>, Option<JsonValue>)> = sqlx::query_as(
        r#"SELECT "lastSyncedArtist", "lastSyncArgs" FROM "Statistics" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await
    .ok()?;

    let (last_artist, args_json) = row?;
    let (from, to, only) = args_json
        .as_ref()
        .map(|v| {
            let from = v.get("from").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let to = v.get("to").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let only = v.get("only").and_then(|x| x.as_str()).unwrap_or("").to_string();
            (from, to, only)
        })
        .unwrap_or_default();

    Some(SyncCheckpoint { last_artist, from, to, only })
}

pub async fn clear_sync_checkpoint(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastSyncedArtist" = NULL, "lastSyncArgs" = NULL, "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}
