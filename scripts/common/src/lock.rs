use chrono::Utc;
use sqlx::PgPool;
use tokio::task::JoinHandle;

/// Keeps the scan lock's `scanLockedAt` fresh every 60s for as long as it is held, so
/// `clear_stale_lock_minutes`'s 10-minute threshold only ever fires on a genuinely dead process, never
/// a long-running one (a whole-library first `./tidy` run can take hours). Dropping the guard aborts
/// the heartbeat task; it does NOT clear the lock row itself - callers still call `release_lock`
/// explicitly, keeping this guard alive until they do.
pub struct LockGuard {
    heartbeat: JoinHandle<()>,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        self.heartbeat.abort();
    }
}

/// Atomically acquire the scan lock in the Statistics singleton row.
/// Returns Err with the current holder's info if the lock is already held.
pub async fn acquire_lock(
    pool: &PgPool,
    binary: &str,
    pid: u32,
    args: &str,
) -> Result<LockGuard, String> {
    // First ensure the Statistics row exists
    sqlx::query(
        r#"INSERT INTO "Statistics" (id, "updatedAt") VALUES ('main', NOW()) ON CONFLICT DO NOTHING"#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let result = sqlx::query(
        r#"UPDATE "Statistics"
           SET "scanLockedBy" = $1, "scanLockedAt" = NOW(), "scanPid" = $2, "updatedAt" = NOW()
           WHERE id = 'main' AND "scanLockedBy" IS NULL"#,
    )
    .bind(binary)
    .bind(pid as i32)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() == 1 => {
            let pool = pool.clone();
            let heartbeat = tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                interval.tick().await; // first tick fires immediately - the UPDATE above just set it
                loop {
                    interval.tick().await;
                    let _ = sqlx::query(
                        r#"UPDATE "Statistics" SET "scanLockedAt" = NOW()
                           WHERE id = 'main' AND "scanPid" = $1"#,
                    )
                    .bind(pid as i32)
                    .execute(&pool)
                    .await;
                }
            });
            Ok(LockGuard { heartbeat })
        }
        _ => {
            // Lock held - read who has it
            let holder: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
                r#"SELECT "scanLockedBy", "scanPid" FROM "Statistics" WHERE id = 'main'"#,
            )
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            let msg = match holder.flatten2() {
                Some((by, pid_val)) => format!("lock held by {} (pid {})", by, pid_val),
                None => "lock held (unknown holder)".to_string(),
            };
            let _ = args; // available for future structured logging
            Err(msg)
        }
    }
}

pub async fn release_lock(pool: &PgPool) {
    sqlx::query(
        r#"UPDATE "Statistics"
           SET "scanLockedBy" = NULL, "scanLockedAt" = NULL, "scanPid" = NULL, "updatedAt" = NOW()
           WHERE id = 'main'"#,
    )
    .execute(pool)
    .await
    .ok();
}

/// Detect and clear a stale lock (held for longer than max_age_minutes).
/// Returns true if a stale lock was found and cleared.
pub async fn clear_stale_lock_minutes(pool: &PgPool, max_age_minutes: u64) -> bool {
    let threshold = Utc::now().naive_utc() - chrono::Duration::minutes(max_age_minutes as i64);

    let result = sqlx::query(
        r#"UPDATE "Statistics"
           SET "scanLockedBy" = NULL, "scanLockedAt" = NULL, "scanPid" = NULL, "updatedAt" = NOW()
           WHERE id = 'main'
             AND "scanLockedBy" IS NOT NULL
             AND "scanLockedAt" < $1"#,
    )
    .bind(threshold)
    .execute(pool)
    .await;

    result.map(|r| r.rows_affected() > 0).unwrap_or(false)
}

// Helper to flatten Option<Option<T>>
trait Flatten2<T> {
    fn flatten2(self) -> Option<T>;
}

impl<A, B> Flatten2<(A, B)> for Option<(Option<A>, Option<B>)> {
    fn flatten2(self) -> Option<(A, B)> {
        self.and_then(|(a, b)| a.zip(b))
    }
}
