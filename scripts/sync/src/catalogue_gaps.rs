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
    // Scope by exact artist id instead of name filtering - used by `./add`, where a name match could
    // cross two same-named artists (e.g. NAPA PT/CL) or trip on a name containing `;`.
    artist_ids: Option<&[String]>,
) -> Result<(u32, u32, Vec<String>), String> {
    let rows: Vec<(String, String, String, Option<String>)> = match artist_ids {
        Some(ids) => sqlx::query_as(
            r#"SELECT id, name, slug, "musicbrainzId"
               FROM "Artist"
               WHERE "primaryArtistId" IS NULL
                 AND "musicbrainzId" IS NOT NULL
                 AND "musicbrainzId" != ''
                 AND id = ANY($1::text[])
               ORDER BY name"#,
        )
        .bind(ids)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("DB query failed: {}", e))?,
        None => sqlx::query_as(
            r#"SELECT id, name, slug, "musicbrainzId"
               FROM "Artist"
               WHERE "primaryArtistId" IS NULL
                 AND "musicbrainzId" IS NOT NULL
                 AND "musicbrainzId" != ''
               ORDER BY name"#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("DB query failed: {}", e))?,
    };

    let artists: Vec<(String, String, String, String)> = rows
        .into_iter()
        .filter(|(_, name, _, _)| {
            artist_ids.is_some()
                || matches_filter(
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
    let mut processed_artist_ids: Vec<String> = Vec::new();

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

        // Release groups carry no status; only the releases inside them do. Without this the gap pass
        // fills the catalogue with bootleg live recordings (primary Album, secondary Live - the same
        // shape as an official live album, which we keep). See `mb_get_official_release_group_ids`.
        // One browse, two answers: the official-group set this gate needs, and the tracklist of every
        // one of those releases - the containment note below is derived from those instead of paying
        // a paginated browse per gap.
        let catalogue =
            match mb_api::mb_get_official_artist_catalogue(http_client, mb_id, limiter).await {
                Ok(c) => c,
                Err(e) => {
                    reporter.err(&format!("{}: {}", name, e));
                    continue;
                }
            };
        let official_rg_ids = &catalogue.official_rg_ids;

        let artist_genre_ids = get_artist_genre_ids(pool, artist_id).await;
        if overwrite {
            delete_missing_releases_for_artist(pool, artist_id).await.ok();
        }
        let mut covered_rg_ids = get_covered_release_group_ids(pool, artist_id).await;
        if !overwrite {
            let existing_missing = get_missing_release_group_ids_for_artist(pool, artist_id).await;
            covered_rg_ids.extend(existing_missing);
        }

        let contained_notes = get_contained_notes_for_artist(pool, artist_id).await;
        let local_bundles = get_local_bundles_for_artist(pool, artist_id).await;
        let mut gap_count = 0u32;
        let mut contained_count = 0u32;
        for rg in &release_groups {
            if covered_rg_ids.contains(&rg.id) {
                continue;
            }
            // Same album-oriented allow-list as the matcher, plus proof the group has an Official
            // release - the release group itself carries no status.
            let secondary = rg.secondary_types.clone().unwrap_or_default();
            if !common::mb::allowlist::is_allowed_gap(
                rg.primary_type.as_deref(),
                &secondary,
                &rg.id,
                official_rg_ids,
            ) {
                continue;
            }
            // The recordings may already sit inside a bigger local release (a box set, a compilation,
            // a two-disc folder). Not ownership of *this* release - it stays a gap, we only note where
            // those recordings already are (see `owned.rs`).
            let contained_note = match contained_notes.get(&rg.id) {
                Some(note) if !overwrite => Some(note.clone()),
                _ => crate::owned::detect_containment(
                    catalogue.editions_by_rg.get(&rg.id).map_or(&[][..], |v| v),
                    &local_bundles,
                )
                .map(|container| crate::owned::containment_note(&container)),
            };
            if let Some(note) = &contained_note {
                contained_count += 1;
                if verbose {
                    reporter.info(&format!("    {} - {}", rg.title, note));
                }
            }
            let type_name = rg.primary_type.as_deref().unwrap_or("Other");
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
                release_group_secondary_types: rg.secondary_types.as_deref().unwrap_or_default(),
                ..Default::default()
            };
            if let Ok(mb_db_id) = upsert_mb_release(
                pool, &rg.id, &rg.id, &rg.title, year, &type_id, "MISSING",
                contained_note.as_deref(), None, &extras,
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
        processed_artist_ids.push(artist_id.clone());

        if gap_count > 0 {
            reporter.ok(&format!("{} missing release(s) appended to catalogue", gap_count));
        }
        if contained_count > 0 {
            reporter.ok(&format!(
                "{} gap(s) noted as recordings already inside another release",
                contained_count
            ));
        }
        if gap_count == 0 && verbose {
            reporter.skip("No gaps");
        }
        reporter.sync_progress(name, i + 1, total, "done");
    }

    Ok((total_artists, total_gaps, processed_artist_ids))
}

/// Shared tail for every `fill_catalogue_gaps` caller (plain `--catalogue-gaps` and `./add`): orphan
/// sweep, then retire owned MISSING placeholders, then recompute statistics. Order is load-bearing -
/// see the comment this used to carry inline in `sync/src/main.rs`: `delete_orphaned_mb_releases` must
/// run BEFORE `retire_owned_missing_placeholders`, or a merge-discard orphan left standing makes retire
/// delete the wrong survivor (the placeholder, not the orphan).
pub async fn finish_run(pool: &PgPool, scope: Option<&[String]>, reporter: &Reporter) {
    if let Ok(n) = delete_orphaned_mb_releases(pool, scope).await {
        if n > 0 {
            reporter.info(&format!("Cleaned up {} orphaned MB release(s)", n));
        }
    }
    if let Ok(n) = retire_owned_missing_placeholders(pool).await {
        if n > 0 {
            reporter.info(&format!("Retired {} owned MISSING placeholder(s)", n));
        }
    }
    common::statistics::update_statistics(pool).await.ok();
}
