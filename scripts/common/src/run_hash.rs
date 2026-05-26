use sqlx::PgPool;

pub fn new_run_hash() -> String {
    cuid2::create_id()
}

pub async fn get_run_hash(pool: &PgPool, field: &str) -> Option<String> {
    let sql = match field {
        "indexRunHash" => r#"SELECT "indexRunHash" FROM "Settings" WHERE id = 'main'"#,
        "syncRunHash" => r#"SELECT "syncRunHash" FROM "Settings" WHERE id = 'main'"#,
        _ => return None,
    };
    let row: Option<(Option<String>,)> = sqlx::query_as(sql)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    row.and_then(|(v,)| v).filter(|s| !s.is_empty())
}

pub async fn set_run_hash(pool: &PgPool, field: &str, hash: &str) {
    let sql = match field {
        "indexRunHash" => {
            r#"INSERT INTO "Settings" (id, "indexRunHash") VALUES ('main', $1)
               ON CONFLICT (id) DO UPDATE SET "indexRunHash" = $1"#
        }
        "syncRunHash" => {
            r#"INSERT INTO "Settings" (id, "syncRunHash") VALUES ('main', $1)
               ON CONFLICT (id) DO UPDATE SET "syncRunHash" = $1"#
        }
        _ => return,
    };
    sqlx::query(sql).bind(hash).execute(pool).await.ok();
}

pub async fn clear_run_hash(pool: &PgPool, field: &str) {
    let sql = match field {
        "indexRunHash" => {
            r#"UPDATE "Settings" SET "indexRunHash" = NULL WHERE id = 'main'"#
        }
        "syncRunHash" => {
            r#"UPDATE "Settings" SET "syncRunHash" = NULL WHERE id = 'main'"#
        }
        _ => return,
    };
    sqlx::query(sql).execute(pool).await.ok();
}
