use common::filters::{matches_filter, sanitize_mb_id};
use common::progress::Reporter;
use reqwest::Client;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::*;
use crate::mb_api::{self, RateLimiter};
use crate::mb_matching::is_special_artist_name;

pub async fn fill_catalogue_gaps(
    pool: &PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &Reporter,
    running: &AtomicBool,
    from: Option<&str>,
    to: Option<&str>,
    only: Option<&str>,
    exact: bool,
    overwrite: bool,
    verbose: bool,
) -> Result<(u32, u32), String> {
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, name, slug, "musicbrainzId"
           FROM "Artist"
           WHERE "relatedOnly" = false
             AND "musicbrainzId" IS NOT NULL
             AND "musicbrainzId" != ''
           ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB query failed: {}", e))?;

    let artists: Vec<(String, String, String, String)> = rows
        .into_iter()
        .filter(|(_, name, _, _)| {
            matches_filter(
                name,
                from.unwrap_or(""),
                to.unwrap_or(""),
                only.unwrap_or(""),
                exact,
            )
        })
        .filter_map(|(id, name, slug, mb_id)| {
            mb_id.and_then(|raw| sanitize_mb_id(&raw)).map(|mb| (id, name, slug, mb))
        })
        .collect();

    let total = artists.len();
    reporter.info(&format!("Processing {} artist(s)...", total));
    reporter.blank();

    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let mut seen_mb_ids: HashSet<String> = HashSet::new();
    let mut total_artists = 0u32;
    let mut total_gaps = 0u32;

    for (i, (artist_id, name, _slug, mb_id)) in artists.iter().enumerate() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        if is_special_artist_name(name) {
            continue;
        }

        if !seen_mb_ids.insert(mb_id.clone()) {
            if verbose {
                reporter.skip(&format!("{} (duplicate MB ID)", name));
            }
            continue;
        }

        reporter.sync_progress(name, i + 1, total, "gaps");
        reporter.item("", name, i + 1, total);

        let release_groups = match mb_api::mb_get_release_groups(http_client, mb_id, limiter).await
        {
            Ok(rgs) => rgs,
            Err(e) => {
                reporter.err(&format!("{}: {}", name, e));
                continue;
            }
        };

        if release_groups.is_empty() {
            if verbose {
                reporter.skip(&format!("{} (no release groups)", name));
            }
            reporter.sync_progress(name, i + 1, total, "done");
            continue;
        }

        let artist_genre_ids = get_artist_genre_ids(pool, artist_id).await;
        if overwrite {
            delete_missing_releases_for_artist(pool, artist_id).await.ok();
        }
        let mut covered_rg_ids = get_covered_release_group_ids(pool, artist_id).await;
        if !overwrite {
            let existing_missing = get_missing_release_group_ids_for_artist(pool, artist_id).await;
            covered_rg_ids.extend(existing_missing);
        }

        let mut gap_count = 0u32;
        for rg in &release_groups {
            if covered_rg_ids.contains(&rg.id) {
                continue;
            }
            let type_name = rg.primary_type.as_deref().unwrap_or("Other");
            if type_name != "Album" && type_name != "EP" {
                continue;
            }
            let type_id = match ensure_release_type_cached(pool, type_name, &mut release_type_cache).await {
                Ok(id) => id,
                Err(_) => continue,
            };
            let year = rg
                .first_release_date
                .as_deref()
                .and_then(|d| d.split('-').next())
                .and_then(|y| y.parse::<i32>().ok());
            let extras = MbReleaseExtras {
                release_date: rg.first_release_date.as_deref(),
                ..Default::default()
            };
            if let Ok(mb_db_id) = upsert_mb_release(
                pool, &rg.id, &rg.id, &rg.title, year, &type_id, "MISSING", None, None, &extras,
            )
            .await
            {
                ensure_mb_release_artist_link(pool, &mb_db_id, artist_id).await.ok();
                batch_link_release_genres(pool, &mb_db_id, &artist_genre_ids).await.ok();
                gap_count += 1;
            }
        }

        total_artists += 1;
        total_gaps += gap_count;

        if gap_count > 0 {
            reporter.ok(&format!("{} gap(s)", gap_count));
        } else if verbose {
            reporter.skip("No gaps");
        }
        reporter.sync_progress(name, i + 1, total, "done");
    }

    Ok((total_artists, total_gaps))
}
