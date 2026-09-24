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
    let row: Option<(Option<String>,)> =
        sqlx::query_as(r#"SELECT "lastIndexedFolder" FROM "Statistics" WHERE id = 'main'"#)
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
