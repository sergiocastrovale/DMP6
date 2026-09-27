use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Executor, PgPool};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;

/// A connection sitting idle in the pool waiting for a free slot, capped so a saturated pool fails
/// fast with a clear error instead of hanging the caller indefinitely.
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);

/// A single query pinned to this, so a runaway/misbehaving statement releases its connection back to
/// the pool eventually instead of holding it forever.
const STATEMENT_TIMEOUT_MS: i64 = 5 * 60 * 1000;

/// `app_name` tags every connection this pool opens with its `application_name` (visible in
/// `pg_stat_activity`) - without it, every one of these binaries' connections looks identical from
/// the database side, and there is no way to tell which binary is holding one during an incident.
pub async fn create_pool(database_url: &str, app_name: &str) -> Result<PgPool, sqlx::Error> {
    let connect_options = PgConnectOptions::from_str(database_url)?
        .application_name(app_name)
        .disable_statement_logging();
    let statement_timeout = format!("SET statement_timeout = {STATEMENT_TIMEOUT_MS}");
    PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .after_connect(move |conn, _meta| {
            let statement_timeout = statement_timeout.clone();
            Box::pin(async move {
                conn.execute(statement_timeout.as_str()).await?;
                Ok(())
            })
        })
        .connect_with(connect_options)
        .await
}

/// For a binary's own startup: connect or print a clear error and exit, rather than every caller
/// repeating the same match arm. Library code (and tests) call `create_pool` directly instead.
pub async fn create_pool_or_exit(database_url: &str, app_name: &str) -> PgPool {
    match create_pool(database_url, app_name).await {
        Ok(pool) => pool,
        Err(e) => {
            crate::progress::early_err(&format!("Cannot connect to database: {e}"));
            std::process::exit(1);
        }
    }
}

/// The artist row for a bare name, following the homonym rules (`crate::homonyms`): the name's only artist, a
/// new row, or - when several artists share the name - its unidentified member. Reconciles the name's group
/// straight away, since callers of this form do not batch.
pub async fn ensure_artist(pool: &PgPool, name: &str) -> Result<String, sqlx::Error> {
    use crate::homonyms::{
        ensure_artist_identity, reconcile_touched, IdSource, IdentityRequest, IdentityState,
    };
    let mut state = IdentityState::new();
    let id = ensure_artist_identity(
        pool,
        &mut state,
        &IdentityRequest {
            name,
            mbid: None,
            source: IdSource::Search,
            release_title: None,
            credit: false,
        },
    )
    .await?;
    reconcile_touched(pool, &mut state).await?;
    if id.is_empty() {
        return Ok(id);
    }
    // A reconcile may have connected the row to a survivor; hand back the row that is shown.
    let primary: Option<String> =
        sqlx::query_scalar(r#"SELECT COALESCE("primaryArtistId", id) FROM "Artist" WHERE id = $1"#)
            .bind(&id)
            .fetch_optional(pool)
            .await?;
    Ok(primary.unwrap_or(id))
}

pub async fn ensure_artist_cached(
    pool: &PgPool,
    name: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    use crate::slug::make_slug;
    let artist_slug = make_slug(name);
    if artist_slug.is_empty() {
        return Ok(String::new());
    }
    if let Some(id) = cache.get(&artist_slug) {
        return Ok(id.clone());
    }
    let id = ensure_artist(pool, name).await?;
    if !id.is_empty() {
        cache.insert(artist_slug, id.clone());
    }
    Ok(id)
}
