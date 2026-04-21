use clap::Parser;
use colored::Colorize;
use common::config::load_config;
use common::db::create_pool;
use common::filters::matches_filter;
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use common::progress::sync_progress;
use common::s3::create_s3_client;
use common::statistics::update_statistics;
use common::types::TrackMeta;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod compound;
mod db;
mod images;
mod mb_api;
mod mb_filter;
mod mb_matching;
mod mb_types;
mod nuke;
mod status;

use compound::cleanup_ghost_artists;
use db::*;
use images::{download_artist_image, download_cover_art};
use mb_api::RateLimiter;
use mb_filter::should_skip_release;
use mb_matching::find_mb_match_with_fallback;
use nuke::nuke_mb_data;
use status::{check_release_status, normalize_title, status_to_db_string};

#[derive(Parser, Debug)]
#[command(name = "sync")]
struct SyncArgs {
    #[arg(long, short)]
    from: Option<String>,
    #[arg(long, short)]
    to: Option<String>,
    #[arg(long, short)]
    only: Option<String>,
    #[arg(long)]
    overwrite: bool,
    #[arg(long)]
    skip_artist_img: bool,
    #[arg(long)]
    skip_release_img: bool,
    #[arg(long)]
    delete: bool,
    #[arg(long)]
    verbose: bool,
}

fn local_track_to_meta(t: &LocalTrackRow) -> TrackMeta {
    let now = chrono::Utc::now().naive_utc();
    TrackMeta {
        file_path: String::new(),
        file_size: 0,
        mtime: now,
        title: t.title.clone(),
        artist: t.artist.clone(),
        album_artist: None,
        album: None,
        year: None,
        genre: None,
        track_number: t.track_number,
        disc_number: t.disc_number,
        duration: None,
        bitrate: None,
        sample_rate: None,
        position: None,
        content_hash: String::new(),
        metadata_json: serde_json::Value::Null,
        has_picture: false,
        mb_album_id: t.mb_album_id.clone(),
        mb_album_artist_id: t.mb_album_artist_id.clone(),
    }
}

#[tokio::main]
async fn main() {
    let args = SyncArgs::parse();
    let config = load_config(None);
    let pool = create_pool(&config.database_url).await;

    if clear_stale_lock_minutes(&pool, 10).await {
        eprintln!("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let lock_args = serde_json::json!({
        "from": args.from,
        "to": args.to,
        "only": args.only,
        "overwrite": args.overwrite,
    });

    if let Err(e) = acquire_lock(&pool, "sync", pid, &lock_args.to_string()).await {
        eprintln!("Cannot start: {}", e);
        std::process::exit(1);
    }

    // SIGTERM / Ctrl-C handler — release lock before exiting
    let running = Arc::new(AtomicBool::new(true));
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            running.store(false, Ordering::SeqCst);
            eprintln!("\nShutdown requested — finishing current artist...");
            // Second Ctrl-C → force exit after releasing lock
            tokio::signal::ctrl_c().await.ok();
            release_lock(&pool2).await;
            std::process::exit(1);
        });
    }
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            let mut term = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate(),
            )
            .expect("SIGTERM handler");
            term.recv().await;
            running.store(false, Ordering::SeqCst);
            release_lock(&pool2).await;
            std::process::exit(0);
        });
    }

    let s3_client = create_s3_client(&config).await;

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP client");

    let mut limiter = RateLimiter::new();

    if args.delete {
        match nuke_mb_data(
            &pool,
            args.from.as_deref(),
            args.to.as_deref(),
            args.only.as_deref(),
            &config.project_root,
            &s3_client,
            &config,
        )
        .await
        {
            Ok(n) => eprintln!("Nuked MB data for {} artists.", n),
            Err(e) => eprintln!("Nuke error: {}", e),
        }
        release_lock(&pool).await;
        return;
    }

    let artists: Vec<ArtistSyncRow> = if args.overwrite {
        let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl" FROM "Artist" ORDER BY name"#,
            )
            .fetch_all(&pool)
            .await
            .expect("DB query failed");

        rows.into_iter()
            .filter(|(_, name, _, _, _, _)| {
                matches_filter(
                    name,
                    args.from.as_deref().unwrap_or(""),
                    args.to.as_deref().unwrap_or(""),
                    args.only.as_deref().unwrap_or(""),
                )
            })
            .map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
                id,
                name,
                slug,
                mb_id,
                has_image: image.is_some() || image_url.is_some(),
            })
            .collect()
    } else {
        get_artists_pending_sync(
            &pool,
            args.from.as_deref(),
            args.to.as_deref(),
            args.only.as_deref(),
        )
        .await
        .expect("DB query failed")
    };

    let total = artists.len();
    eprintln!("Syncing {} artist(s)...", total);

    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let mut genre_cache: HashMap<String, String> = HashMap::new();

    for (i, artist) in artists.iter().enumerate() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        sync_progress(&artist.name, i + 1, total, "syncing");
        eprint!("  [{}] {}...", i + 1, artist.name);

        let local_releases = match get_local_releases_for_artist(&pool, &artist.id).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!(" error: {}", e);
                continue;
            }
        };

        if local_releases.is_empty() {
            eprintln!(" skipped (no releases)");
            sync_progress(&artist.name, i + 1, total, "skipped");
            continue;
        }

        // Collect sample tracks for MB matching (up to 5)
        let mut sample_track_rows: Vec<LocalTrackRow> = Vec::new();
        for release in &local_releases {
            if sample_track_rows.len() >= 5 {
                break;
            }
            if let Ok(tracks) = get_local_tracks_for_release(&pool, &release.id).await {
                sample_track_rows.extend(tracks);
            }
        }
        let sample_metas: Vec<TrackMeta> = sample_track_rows.iter().map(local_track_to_meta).collect();
        let sample_refs: Vec<&TrackMeta> = sample_metas.iter().collect();

        // Artist MB match
        let mb_artist = if let Some(ref existing_id) = artist.mb_id {
            if !existing_id.is_empty() && !args.overwrite {
                match mb_api::mb_lookup_artist(&http_client, existing_id, &mut limiter).await {
                    Ok(m) => Some(m),
                    Err(_) => {
                        find_mb_match_with_fallback(&http_client, &mut limiter, &artist.name, &sample_refs)
                            .await
                            .unwrap_or(None)
                    }
                }
            } else {
                find_mb_match_with_fallback(&http_client, &mut limiter, &artist.name, &sample_refs)
                    .await
                    .unwrap_or(None)
            }
        } else {
            find_mb_match_with_fallback(&http_client, &mut limiter, &artist.name, &sample_refs)
                .await
                .unwrap_or(None)
        };

        let mb_artist = match mb_artist {
            Some(m) => m,
            None => {
                eprintln!(" no MB match");
                sync_progress(&artist.name, i + 1, total, "no_match");
                let now = chrono::Utc::now().naive_utc();
                sqlx::query(
                    r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(&artist.id)
                .execute(&pool)
                .await
                .ok();
                continue;
            }
        };

        // Artist detail (genres, URLs)
        let detail = match mb_api::mb_get_artist_detail(&http_client, &mb_artist.id, &mut limiter).await {
            Ok(d) => d,
            Err(e) => {
                eprintln!(" detail error: {}", e);
                continue;
            }
        };

        // Upsert genres and link
        let mut artist_genre_ids: Vec<String> = Vec::new();
        if let Some(ref genres) = detail.genres {
            let mut sorted = genres.to_vec();
            sorted.sort_by(|a, b| b.count.unwrap_or(0).cmp(&a.count.unwrap_or(0)));
            for genre in sorted.iter().take(5) {
                if let Ok(id) = ensure_genre_cached(&pool, &genre.name, &mut genre_cache).await {
                    artist_genre_ids.push(id);
                }
            }
        }
        batch_link_artist_genres(&pool, &artist.id, &artist_genre_ids)
            .await
            .ok();

        // Upsert URLs
        let urls: Vec<(String, String)> = detail
            .relations
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|r| r.url.as_ref().map(|u| (r.relation_type.clone(), u.resource.clone())))
            .collect();
        batch_upsert_artist_urls(&pool, &artist.id, &urls).await.ok();

        // Artist image — skip if already present in DB (image or imageUrl set)
        if !args.skip_artist_img && !artist.has_image {
            if let Ok(true) = download_artist_image(
                &http_client,
                &detail,
                &artist.slug,
                &config.project_root,
                &s3_client,
                &config,
            )
            .await
            {
                if config.use_local() {
                    let filename = format!("{}.jpg", &artist.slug);
                    sqlx::query(
                        r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&filename)
                    .bind(&artist.id)
                    .execute(&pool)
                    .await
                    .ok();
                }
                if config.use_s3() {
                    if let Some(ref public_url) = config.s3_public_url {
                        let image_url = format!(
                            "{}/artists/{}.jpg",
                            public_url.trim_end_matches('/'),
                            &artist.slug
                        );
                        sqlx::query(
                            r#"UPDATE "Artist" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&image_url)
                        .bind(&artist.id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                }
            }
        }

        // Release groups
        let release_groups =
            match mb_api::mb_get_release_groups(&http_client, &mb_artist.id, &mut limiter).await {
                Ok(rgs) => rgs,
                Err(e) => {
                    eprintln!(" release groups error: {}", e);
                    vec![]
                }
            };

        let mut score_sum = 0f64;
        let mut score_count = 0u32;

        for local_release in &local_releases {
            if local_release.forced_complete {
                continue;
            }

            let local_title_norm = normalize_title(&local_release.title);
            let rg = release_groups.iter().find(|rg| {
                !should_skip_release(rg) && normalize_title(&rg.title) == local_title_norm
            });

            let rg = match rg {
                Some(r) => r,
                None => {
                    if args.verbose {
                        eprintln!("\n    Skipped: {} (no MB match)", local_release.title);
                    }
                    continue;
                }
            };

            let type_name = rg.primary_type.as_deref().unwrap_or("Other");
            let type_id = match ensure_release_type_cached(&pool, type_name, &mut release_type_cache).await {
                Ok(id) => id,
                Err(_) => continue,
            };

            let year = rg
                .first_release_date
                .as_deref()
                .and_then(|d| d.split('-').next())
                .and_then(|y| y.parse::<i32>().ok());

            let mb_release_tracks =
                match mb_api::mb_get_release_tracks(&http_client, &rg.id, &mut limiter).await {
                    Ok(t) => t,
                    Err(_) => vec![],
                };

            let local_tracks = match get_local_tracks_for_release(&pool, &local_release.id).await {
                Ok(t) => t,
                Err(_) => continue,
            };

            let local_track_ids: Vec<String> = local_tracks.iter().map(|t| t.id.clone()).collect();
            let local_metas: Vec<TrackMeta> = local_tracks.iter().map(local_track_to_meta).collect();
            let local_meta_refs: Vec<&TrackMeta> = local_metas.iter().collect();

            let mb_flat_tracks: Vec<crate::mb_types::MbTrack> = mb_release_tracks
                .iter()
                .flat_map(|(_, tracks)| tracks.clone())
                .collect();

            let status_check =
                check_release_status(&local_meta_refs, &local_track_ids, &mb_release_tracks);
            let status_str = status_to_db_string(&status_check.status);

            let mb_db_id = match upsert_mb_release(
                &pool,
                &rg.id,
                &rg.title,
                year,
                &type_id,
                status_str,
                None,
            )
            .await
            {
                Ok(id) => id,
                Err(_) => continue,
            };

            ensure_mb_release_artist_link(&pool, &mb_db_id, &artist.id)
                .await
                .ok();

            delete_mb_tracks_for_release(&pool, &mb_db_id).await.ok();

            let track_rows: Vec<MbTrackRow> = mb_flat_tracks
                .iter()
                .map(|t| MbTrackRow {
                    title: t.title.clone(),
                    position: t.position.map(|p| p as i32),
                    disc_number: None,
                    duration_ms: t.length.map(|l| l as i32),
                    mb_id: Some(t.id.clone()),
                })
                .collect();

            let inserted_tracks = batch_insert_mb_tracks(&pool, &mb_db_id, &track_rows)
                .await
                .unwrap_or_default();

            let track_links: Vec<(String, String)> = status_check
                .matched_mb_tracks
                .iter()
                .filter_map(|(mb_track, local_id_opt)| {
                    let local_id = local_id_opt.as_ref()?;
                    let db_id = inserted_tracks
                        .iter()
                        .find(|(_, mid)| mid.as_deref() == Some(mb_track.id.as_str()))
                        .map(|(db_id, _)| db_id.clone())?;
                    Some((local_id.clone(), db_id))
                })
                .collect();
            link_local_tracks_to_mb(&pool, &track_links).await.ok();

            update_local_release_match(&pool, &local_release.id, &mb_db_id, status_str, None)
                .await
                .ok();

            // Release genres from artist genres (propagate top genres)
            batch_link_release_genres(&pool, &mb_db_id, &artist_genre_ids)
                .await
                .ok();

            if !args.skip_release_img {
                if let Ok(true) = download_cover_art(
                    &http_client,
                    &rg.id,
                    &config.project_root,
                    &s3_client,
                    &config,
                )
                .await
                {
                    let filename = format!("{}.jpg", &rg.id);
                    if config.use_local() {
                        sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&filename)
                        .bind(&local_release.id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                    if config.use_s3() {
                        if let Some(ref public_url) = config.s3_public_url {
                            let image_url = format!(
                                "{}/releases/{}",
                                public_url.trim_end_matches('/'),
                                &filename
                            );
                            sqlx::query(
                                r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                            )
                            .bind(&image_url)
                            .bind(&local_release.id)
                            .execute(&pool)
                            .await
                            .ok();
                        }
                    }
                }
            }

            score_sum += match status_check.status {
                status::ReleaseStatus::Complete => 100.0,
                status::ReleaseStatus::ExtraTracks => 85.0,
                status::ReleaseStatus::MissingTracks => 70.0,
                status::ReleaseStatus::Incomplete => 50.0,
            };
            score_count += 1;
        }

        let avg_score = if score_count > 0 {
            Some(score_sum / score_count as f64)
        } else {
            None
        };

        update_artist_sync_stats(&pool, &artist.id, &mb_artist.id, avg_score)
            .await
            .ok();

        let synced_label = if score_count > 0 {
            format!("{} release(s)", score_count).green().to_string()
        } else {
            "0 releases".yellow().to_string()
        };
        eprintln!(" {}", synced_label);
        sync_progress(&artist.name, i + 1, total, "done");
    }

    cleanup_ghost_artists(&pool, &config).await.ok();
    update_statistics(&pool).await.ok();
    release_lock(&pool).await;

    eprintln!("{}", "Sync complete.".green());
}
