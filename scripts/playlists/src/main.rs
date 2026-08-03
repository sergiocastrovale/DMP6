use chrono::Utc;
use clap::Parser;
use colored::*;
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "playlists",
    about = "Generate genre-based and region-based playlists"
)]
struct Args {
    /// Dry run - show what would be created without writing to DB
    #[arg(long)]
    dry_run: bool,

    /// Show all genres and their group assignments
    #[arg(long)]
    report: bool,

    /// Update only a specific genre group (by slug)
    #[arg(long)]
    group: Option<String>,

    /// Path to custom genre-groups.json config file
    #[arg(long)]
    config: Option<String>,

    /// Skip genre playlists
    #[arg(long)]
    no_genres: bool,

    /// Skip region playlists
    #[arg(long)]
    no_regions: bool,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
struct GenreConfig {
    max_tracks: usize,
    max_per_release: usize,
    groups: Vec<GenreGroup>,
}

#[derive(Deserialize, Debug)]
struct GenreGroup {
    name: String,
    slug: String,
    description: String,
    roots: Vec<String>,
    includes: Vec<String>,
    excludes: Vec<String>,
}

#[derive(Deserialize, Debug)]
struct RegionConfig {
    max_tracks: usize,
    max_per_release: usize,
    groups: Vec<RegionGroup>,
}

#[derive(Deserialize, Debug)]
struct RegionGroup {
    name: String,
    slug: String,
    description: String,
    countries: Vec<String>,
}

struct AppConfig {
    database_url: String,
}

fn load_env() -> AppConfig {
    let env_paths = [PathBuf::from("web/.env"), PathBuf::from("../../web/.env")];

    let mut env_loaded = false;
    for p in &env_paths {
        if p.exists() {
            dotenvy::from_path(p).ok();
            env_loaded = true;
            break;
        }
    }

    if !env_loaded {
        if let Ok(project_root) = std::env::var("PROJECT_ROOT") {
            let env_path = PathBuf::from(&project_root).join("web/.env");
            if env_path.exists() {
                dotenvy::from_path(env_path).ok();
            }
        }
    }

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");

    AppConfig { database_url }
}

fn load_genre_config(custom_path: Option<&str>) -> GenreConfig {
    let config_paths = match custom_path {
        Some(p) => vec![PathBuf::from(p)],
        None => vec![
            PathBuf::from("scripts/playlists/genre-groups.json"),
            PathBuf::from("genre-groups.json"),
            PathBuf::from("../../scripts/playlists/genre-groups.json"),
        ],
    };

    for path in &config_paths {
        if path.exists() {
            let content = std::fs::read_to_string(path)
                .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
            return serde_json::from_str(&content)
                .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
        }
    }

    // Try relative to executable location
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let path = exe_dir.join("../../genre-groups.json");
            if path.exists() {
                let content = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
                return serde_json::from_str(&content)
                    .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
            }
        }
    }

    panic!(
        "genre-groups.json not found. Tried: {:?}",
        config_paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );
}

fn load_region_config() -> RegionConfig {
    let config_paths = vec![
        PathBuf::from("scripts/playlists/region-groups.json"),
        PathBuf::from("region-groups.json"),
        PathBuf::from("../../scripts/playlists/region-groups.json"),
    ];

    for path in &config_paths {
        if path.exists() {
            let content = std::fs::read_to_string(path)
                .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
            return serde_json::from_str(&content)
                .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let path = exe_dir.join("../../region-groups.json");
            if path.exists() {
                let content = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
                return serde_json::from_str(&content)
                    .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
            }
        }
    }

    panic!(
        "region-groups.json not found. Tried: {:?}",
        config_paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Genre Matching
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct GenreMatch {
    genre_id: String,
    #[allow(dead_code)]
    genre_name: String,
    weight: f64,
}

/// Match a genre name against a genre group, returning a weight (0.0 = no match, 1.0 = exact root)
fn match_genre(genre_name: &str, group: &GenreGroup) -> Option<f64> {
    let name_lower = genre_name.to_lowercase();

    // Check excludes first
    for exc in &group.excludes {
        if name_lower == exc.to_lowercase() {
            return None;
        }
    }

    // Check exact root match (weight 1.0)
    for root in &group.roots {
        if name_lower == root.to_lowercase() {
            return Some(1.0);
        }
    }

    // Check if genre contains root as a word boundary match (weight 0.8)
    for root in &group.roots {
        let root_lower = root.to_lowercase();
        if contains_as_word(&name_lower, &root_lower) {
            return Some(0.8);
        }
    }

    // Check includes list (weight 0.6)
    for inc in &group.includes {
        if name_lower == inc.to_lowercase() {
            return Some(0.6);
        }
    }

    // Check if genre contains root as substring (weight 0.4)
    for root in &group.roots {
        let root_lower = root.to_lowercase();
        if name_lower.contains(&root_lower) && name_lower != root_lower {
            return Some(0.4);
        }
    }

    None
}

/// Check if `haystack` contains `needle` as a whole word
fn contains_as_word(haystack: &str, needle: &str) -> bool {
    if haystack == needle {
        return true;
    }

    // Find all occurrences and check word boundaries
    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    let needle_len = needle_bytes.len();

    let mut start = 0;
    while start + needle_len <= haystack_bytes.len() {
        if let Some(pos) = haystack[start..].find(needle) {
            let abs_pos = start + pos;
            let before_ok = abs_pos == 0 || !haystack_bytes[abs_pos - 1].is_ascii_alphanumeric();
            let after_pos = abs_pos + needle_len;
            let after_ok = after_pos >= haystack_bytes.len()
                || !haystack_bytes[after_pos].is_ascii_alphanumeric();

            if before_ok && after_ok {
                return true;
            }
            start = abs_pos + 1;
        } else {
            break;
        }
    }

    false
}

// ---------------------------------------------------------------------------
// Database Queries
// ---------------------------------------------------------------------------

async fn fetch_all_genres(pool: &PgPool) -> Vec<(String, String)> {
    sqlx::query_as::<_, (String, String)>(r#"SELECT id, name FROM "Genre" ORDER BY name"#)
        .fetch_all(pool)
        .await
        .expect("Failed to fetch genres")
}

async fn fetch_artist_genre_links(pool: &PgPool, genre_ids: &[String]) -> Vec<(String, String)> {
    if genre_ids.is_empty() {
        return vec![];
    }
    // _ArtistGenres: "A" = artist_id, "B" = genre_id
    sqlx::query_as::<_, (String, String)>(
        r#"SELECT "A", "B" FROM "_ArtistGenres" WHERE "B" = ANY($1)"#,
    )
    .bind(genre_ids)
    .fetch_all(pool)
    .await
    .expect("Failed to fetch artist-genre links")
}

#[derive(Debug)]
struct TrackCandidate {
    track_id: String,
    artist_id: String,
    local_release_id: Option<String>,
}

async fn fetch_tracks_for_artists(pool: &PgPool, artist_ids: &[String]) -> Vec<TrackCandidate> {
    if artist_ids.is_empty() {
        return vec![];
    }
    let rows: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT DISTINCT lrt.id, lra."artistId", lrt."localReleaseId", lrt.genre
        FROM "LocalReleaseTrack" lrt
        JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
        WHERE lra."artistId" = ANY($1)
          AND lrt."localReleaseId" IS NOT NULL
          AND lrt.title IS NOT NULL
        "#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await
    .expect("Failed to fetch tracks");

    rows.into_iter()
        .map(
            |(track_id, artist_id, local_release_id, _genre)| TrackCandidate {
                track_id,
                artist_id,
                local_release_id,
            },
        )
        .collect()
}

async fn fetch_tracks_for_countries(
    pool: &PgPool,
    country_codes: &[String],
) -> Vec<TrackCandidate> {
    if country_codes.is_empty() {
        return vec![];
    }
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT DISTINCT lrt.id, lra."artistId", lrt."localReleaseId"
        FROM "LocalReleaseTrack" lrt
        JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
        JOIN "Artist" a ON a.id = lra."artistId"
        WHERE a.country = ANY($1)
          AND a."primaryArtistId" IS NULL
          AND lrt."localReleaseId" IS NOT NULL
          AND lrt.title IS NOT NULL
        "#,
    )
    .bind(country_codes)
    .fetch_all(pool)
    .await
    .expect("Failed to fetch tracks for countries");

    rows.into_iter()
        .map(|(track_id, artist_id, local_release_id)| TrackCandidate {
            track_id,
            artist_id,
            local_release_id,
        })
        .collect()
}

async fn upsert_region_playlist(
    pool: &PgPool,
    group: &RegionGroup,
    track_ids: &[String],
) -> Result<(), sqlx::Error> {
    let playlist_slug = format!("region-{}", group.slug);

    let existing: Option<(String,)> =
        sqlx::query_as(r#"SELECT id FROM "Playlist" WHERE "regionGroup" = $1"#)
            .bind(&group.slug)
            .fetch_optional(pool)
            .await?;

    let playlist_id = if let Some((id,)) = existing {
        sqlx::query(
            r#"UPDATE "Playlist" SET name = $1, slug = $2, description = $3, "updatedAt" = NOW() WHERE id = $4"#,
        )
        .bind(&group.name)
        .bind(&playlist_slug)
        .bind(&group.description)
        .bind(&id)
        .execute(pool)
        .await?;
        id
    } else {
        let id = generate_cuid();
        sqlx::query(
            r#"INSERT INTO "Playlist" (id, name, slug, description, type, "regionGroup", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, 'REGION', $5, NOW(), NOW())"#,
        )
        .bind(&id)
        .bind(&group.name)
        .bind(&playlist_slug)
        .bind(&group.description)
        .bind(&group.slug)
        .execute(pool)
        .await?;
        id
    };

    // DELETE + INSERT in one transaction - a crash/error between the two previously left the
    // playlist emptied (tracks deleted, replacement never inserted) until the next successful
    // regen (audit #89).
    let mut tx = pool.begin().await?;

    sqlx::query(r#"DELETE FROM "PlaylistTrack" WHERE "playlistId" = $1"#)
        .bind(&playlist_id)
        .execute(&mut *tx)
        .await?;

    if !track_ids.is_empty() {
        let mut ids = Vec::with_capacity(track_ids.len());
        let mut positions = Vec::with_capacity(track_ids.len());
        let mut playlist_ids = Vec::with_capacity(track_ids.len());
        let mut t_ids = Vec::with_capacity(track_ids.len());

        for (i, track_id) in track_ids.iter().enumerate() {
            ids.push(generate_cuid());
            positions.push((i + 1) as i32);
            playlist_ids.push(playlist_id.clone());
            t_ids.push(track_id.clone());
        }

        sqlx::query(
            r#"
            INSERT INTO "PlaylistTrack" (id, position, "playlistId", "trackId", "createdAt")
            SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::text[], $5::timestamp[])
            "#,
        )
        .bind(&ids)
        .bind(&positions)
        .bind(&playlist_ids)
        .bind(&t_ids)
        .bind(&vec![Utc::now().naive_utc(); track_ids.len()])
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(())
}

async fn upsert_playlist(
    pool: &PgPool,
    group: &GenreGroup,
    track_ids: &[String],
) -> Result<(), sqlx::Error> {
    let playlist_slug = format!("genre-{}", group.slug);

    // Check if playlist exists
    let existing: Option<(String,)> =
        sqlx::query_as(r#"SELECT id FROM "Playlist" WHERE "genreGroup" = $1"#)
            .bind(&group.slug)
            .fetch_optional(pool)
            .await?;

    let playlist_id = if let Some((id,)) = existing {
        // Update existing playlist
        sqlx::query(
            r#"UPDATE "Playlist" SET name = $1, slug = $2, description = $3, "updatedAt" = NOW() WHERE id = $4"#,
        )
        .bind(&group.name)
        .bind(&playlist_slug)
        .bind(&group.description)
        .bind(&id)
        .execute(pool)
        .await?;
        id
    } else {
        // Create new playlist
        let id = generate_cuid();
        sqlx::query(
            r#"INSERT INTO "Playlist" (id, name, slug, description, type, "genreGroup", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, 'GENRE', $5, NOW(), NOW())"#,
        )
        .bind(&id)
        .bind(&group.name)
        .bind(&playlist_slug)
        .bind(&group.description)
        .bind(&group.slug)
        .execute(pool)
        .await?;
        id
    };

    // DELETE + INSERT in one transaction - a crash/error between the two previously left the
    // playlist emptied (tracks deleted, replacement never inserted) until the next successful
    // regen (audit #89).
    let mut tx = pool.begin().await?;

    sqlx::query(r#"DELETE FROM "PlaylistTrack" WHERE "playlistId" = $1"#)
        .bind(&playlist_id)
        .execute(&mut *tx)
        .await?;

    // Batch insert tracks
    if !track_ids.is_empty() {
        let mut ids = Vec::with_capacity(track_ids.len());
        let mut positions = Vec::with_capacity(track_ids.len());
        let mut playlist_ids = Vec::with_capacity(track_ids.len());
        let mut t_ids = Vec::with_capacity(track_ids.len());

        for (i, track_id) in track_ids.iter().enumerate() {
            ids.push(generate_cuid());
            positions.push((i + 1) as i32);
            playlist_ids.push(playlist_id.clone());
            t_ids.push(track_id.clone());
        }

        sqlx::query(
            r#"
            INSERT INTO "PlaylistTrack" (id, position, "playlistId", "trackId", "createdAt")
            SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::text[], $5::timestamp[])
            "#,
        )
        .bind(&ids)
        .bind(&positions)
        .bind(&playlist_ids)
        .bind(&t_ids)
        .bind(&vec![Utc::now().naive_utc(); track_ids.len()])
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

fn generate_cuid() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let random: u64 = rng.gen();
    format!("c{}{:016x}", timestamp, random)
}

// ---------------------------------------------------------------------------
// Track Selection Algorithm
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ScoredTrack {
    track_id: String,
    release_id: Option<String>,
    score: f64,
}

fn select_tracks(
    tracks: Vec<TrackCandidate>,
    artist_scores: &HashMap<String, f64>,
    config: &GenreConfig,
) -> Vec<String> {
    let mut candidates: Vec<ScoredTrack> = tracks
        .into_iter()
        .filter_map(|t| {
            let &score = artist_scores.get(&t.artist_id)?;
            Some(ScoredTrack {
                track_id: t.track_id,
                release_id: t.local_release_id,
                score,
            })
        })
        .collect();

    // Deduplicate by track_id, keeping highest score
    // (a track can appear multiple times via different artist roles)
    candidates.sort_by(|a, b| {
        a.track_id.cmp(&b.track_id).then(
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    candidates.dedup_by(|a, b| a.track_id == b.track_id);

    // Shuffle BEFORE sorting so a stable sort's tie-break (equal score) picks a random order each
    // run instead of always the same insertion order - otherwise, with static artist scores, a big
    // equal-score band means the SAME top max_tracks subset gets selected every regeneration, and the
    // post-cap shuffle below only randomizes playback order within that frozen subset (audit #88).
    use rand::seq::SliceRandom;
    candidates.shuffle(&mut rand::thread_rng());

    // Sort by score descending to pick the best candidates
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Take top max_tracks respecting max_per_release
    let mut release_counts: HashMap<String, usize> = HashMap::new();
    let mut selected = Vec::new();

    for track in candidates {
        if selected.len() >= config.max_tracks {
            break;
        }
        if let Some(ref release_id) = track.release_id {
            let count = release_counts.entry(release_id.clone()).or_insert(0);
            if *count >= config.max_per_release {
                continue;
            }
            *count += 1;
        }
        selected.push(track.track_id);
    }

    // Shuffle the final selection so playback order is fresh on every regeneration
    selected.shuffle(&mut rand::thread_rng());

    selected
}

fn select_region_tracks(tracks: Vec<TrackCandidate>, config: &RegionConfig) -> Vec<String> {
    let artist_scores: HashMap<String, f64> =
        tracks.iter().map(|t| (t.artist_id.clone(), 1.0)).collect();

    let mut candidates: Vec<ScoredTrack> = tracks
        .into_iter()
        .map(|t| ScoredTrack {
            track_id: t.track_id,
            release_id: t.local_release_id,
            score: *artist_scores.get(&t.artist_id).unwrap_or(&1.0),
        })
        .collect();

    candidates.sort_by(|a, b| {
        a.track_id.cmp(&b.track_id).then(
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    candidates.dedup_by(|a, b| a.track_id == b.track_id);

    use rand::seq::SliceRandom;
    candidates.shuffle(&mut rand::thread_rng());

    let mut release_counts: HashMap<String, usize> = HashMap::new();
    let mut selected = Vec::new();

    for track in candidates {
        if selected.len() >= config.max_tracks {
            break;
        }
        if let Some(ref release_id) = track.release_id {
            let count = release_counts.entry(release_id.clone()).or_insert(0);
            if *count >= config.max_per_release {
                continue;
            }
            *count += 1;
        }
        selected.push(track.track_id);
    }

    selected
}

// ---------------------------------------------------------------------------
// Report Mode
// ---------------------------------------------------------------------------

fn print_report(genres: &[(String, String)], groups: &[GenreGroup]) {
    println!("{}", "Genre Assignment Report".bold());
    println!("{}", "=".repeat(70));
    println!();

    // Build genre → groups mapping
    let mut genre_assignments: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    let mut unmatched: Vec<String> = Vec::new();

    for (_, genre_name) in genres {
        let mut matches = Vec::new();
        for group in groups {
            if let Some(weight) = match_genre(genre_name, group) {
                matches.push((group.name.clone(), weight));
            }
        }
        if matches.is_empty() {
            unmatched.push(genre_name.clone());
        } else {
            genre_assignments.insert(genre_name.clone(), matches);
        }
    }

    // Print assigned genres by group
    for group in groups {
        let mut group_genres: Vec<(&String, f64)> = Vec::new();
        for (genre_name, assignments) in &genre_assignments {
            for (group_name, weight) in assignments {
                if group_name == &group.name {
                    group_genres.push((genre_name, *weight));
                }
            }
        }
        group_genres.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(b.0)));

        println!(
            "{} {} ({} genres)",
            "●".cyan(),
            group.name.bold(),
            group_genres.len()
        );

        for (genre_name, weight) in &group_genres {
            let weight_label = match *weight {
                w if w >= 1.0 => "exact".green(),
                w if w >= 0.8 => "word".bright_green(),
                w if w >= 0.6 => "include".yellow(),
                _ => "substr".bright_black(),
            };
            println!("    {:.1} [{}] {}", weight, weight_label, genre_name);
        }
        println!();
    }

    // Print unmatched
    if !unmatched.is_empty() {
        println!(
            "{} {} ({} genres)",
            "○".bright_black(),
            "Unmatched".bright_black().bold(),
            unmatched.len()
        );
        for name in &unmatched {
            println!("    {}", name.bright_black());
        }
        println!();
    }

    println!(
        "Total: {} genres, {} assigned, {} unmatched",
        genres.len(),
        genre_assignments.len(),
        unmatched.len()
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();
    common::error_log::init("playlists");

    println!("DMP Genre Playlists");
    println!("===================");
    if args.dry_run {
        println!(
            "Mode: {} (no changes will be made)",
            "DRY RUN".yellow().bold()
        );
    }
    if args.report {
        println!("Mode: {}", "REPORT".cyan().bold());
    }
    println!();

    // Load config
    let app_config = load_env();
    let genre_config = load_genre_config(args.config.as_deref());
    let region_config = load_region_config();

    println!(
        "Config: {} genre groups, {} region groups, max {} tracks/playlist",
        genre_config.groups.len(),
        region_config.groups.len(),
        genre_config.max_tracks,
    );
    println!();

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&app_config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    // Fetch all genres
    let all_genres = fetch_all_genres(&pool).await;
    println!(
        "  {} {} genres in database",
        "→".bright_black(),
        all_genres.len()
    );

    // Filter groups if --group is specified
    let groups: Vec<&GenreGroup> = if let Some(ref group_slug) = args.group {
        let filtered: Vec<&GenreGroup> = genre_config
            .groups
            .iter()
            .filter(|g| g.slug == *group_slug)
            .collect();
        if filtered.is_empty() {
            // Also check region groups
            let region_match = region_config.groups.iter().any(|g| g.slug == *group_slug);
            if !region_match {
                let all_slugs: Vec<&str> = genre_config
                    .groups
                    .iter()
                    .map(|g| g.slug.as_str())
                    .chain(region_config.groups.iter().map(|g| g.slug.as_str()))
                    .collect();
                common::error_log::log_error(&format!("No group found with slug '{}'", group_slug));
                eprintln!(
                    "{} No group found with slug '{}'. Available: {}",
                    "✗".red(),
                    group_slug,
                    all_slugs.join(", ")
                );
                std::process::exit(1);
            }
        }
        filtered
    } else {
        genre_config.groups.iter().collect()
    };

    let region_groups: Vec<&RegionGroup> = if let Some(ref group_slug) = args.group {
        region_config
            .groups
            .iter()
            .filter(|g| g.slug == *group_slug)
            .collect()
    } else {
        region_config.groups.iter().collect()
    };

    // Report mode: just show assignments and exit
    if args.report {
        println!();
        print_report(&all_genres, &genre_config.groups);
        return;
    }

    // Same DB scan lock index/sync/fix/delete/nuke use - regen mutates PlaylistTrack rows and reads
    // artist/genre/track tables that index/sync are actively writing, so a concurrent run of either
    // could otherwise interleave with this pass (audit #89, pairs #51). Skipped for --dry-run, which
    // never writes.
    if !args.dry_run {
        if clear_stale_lock_minutes(&pool, 10).await {
            println!("{}", "Cleared a stale lock.".yellow());
        }
        if let Err(e) = acquire_lock(&pool, "playlists", std::process::id(), "").await {
            eprintln!("{}: {}", "Cannot start".red(), e);
            std::process::exit(1);
        }
    }

    println!();

    let mut total_playlists = 0;
    let mut total_tracks = 0;

    // --- Genre playlists ---
    if !args.no_genres && !groups.is_empty() {
        println!("  {} {}", "▸".bright_black(), "Genre Playlists".bold());
        println!();

        for group in &groups {
            print!("  {} {}... ", "●".cyan(), group.name.bold());

            let genre_matches: Vec<GenreMatch> = all_genres
                .iter()
                .filter_map(|(id, name)| {
                    match_genre(name, group).map(|weight| GenreMatch {
                        genre_id: id.clone(),
                        genre_name: name.clone(),
                        weight,
                    })
                })
                .collect();

            if genre_matches.is_empty() {
                println!("{} no matching genres", "○".bright_black());
                continue;
            }

            let genre_weights: HashMap<String, f64> = genre_matches
                .iter()
                .map(|m| (m.genre_id.clone(), m.weight))
                .collect();

            let genre_ids: Vec<String> = genre_matches.iter().map(|m| m.genre_id.clone()).collect();
            let artist_links = fetch_artist_genre_links(&pool, &genre_ids).await;

            if artist_links.is_empty() {
                println!("{} no artists with matching genres", "○".bright_black());
                continue;
            }

            let mut artist_scores: HashMap<String, f64> = HashMap::new();
            for (artist_id, genre_id) in &artist_links {
                if let Some(&weight) = genre_weights.get(genre_id) {
                    let entry = artist_scores.entry(artist_id.clone()).or_insert(0.0);
                    if weight > *entry {
                        *entry = weight;
                    }
                }
            }

            let artist_ids: Vec<String> = artist_scores.keys().cloned().collect();
            let tracks = fetch_tracks_for_artists(&pool, &artist_ids).await;

            if tracks.is_empty() {
                println!("{} no tracks found", "○".bright_black());
                continue;
            }

            let selected = select_tracks(tracks, &artist_scores, &genre_config);

            if selected.len() < 10 {
                println!(
                    "{} only {} tracks (min 10 required, skipping)",
                    "○".bright_black(),
                    selected.len()
                );
                continue;
            }

            if args.dry_run {
                println!(
                    "{} {} genres, {} artists, {} tracks (dry run)",
                    "○".cyan(),
                    genre_matches.len(),
                    artist_scores.len(),
                    selected.len()
                );
            } else {
                match upsert_playlist(&pool, group, &selected).await {
                    Ok(_) => {
                        println!(
                            "{} {} genres, {} artists, {} tracks",
                            "✓".green(),
                            genre_matches.len(),
                            artist_scores.len(),
                            selected.len()
                        );
                        total_playlists += 1;
                        total_tracks += selected.len();
                    }
                    Err(e) => {
                        println!("{} failed: {}", "✗".red(), e);
                    }
                }
            }
        }
    }

    // --- Region playlists ---
    if !args.no_regions && !region_groups.is_empty() {
        println!();
        println!("  {} {}", "▸".bright_black(), "Region Playlists".bold());
        println!();

        for group in &region_groups {
            print!("  {} {}... ", "●".magenta(), group.name.bold());

            let countries: Vec<String> = group.countries.iter().map(|c| c.clone()).collect();
            let tracks = fetch_tracks_for_countries(&pool, &countries).await;

            if tracks.is_empty() {
                println!("{} no tracks found", "○".bright_black());
                continue;
            }

            let selected = select_region_tracks(tracks, &region_config);

            if selected.len() < 10 {
                println!(
                    "{} only {} tracks (min 10 required, skipping)",
                    "○".bright_black(),
                    selected.len()
                );
                continue;
            }

            if args.dry_run {
                println!(
                    "{} {} countries, {} tracks (dry run)",
                    "○".magenta(),
                    group.countries.len(),
                    selected.len()
                );
            } else {
                match upsert_region_playlist(&pool, group, &selected).await {
                    Ok(_) => {
                        println!(
                            "{} {} countries, {} tracks",
                            "✓".green(),
                            group.countries.len(),
                            selected.len()
                        );
                        total_playlists += 1;
                        total_tracks += selected.len();
                    }
                    Err(e) => {
                        println!("{} failed: {}", "✗".red(), e);
                    }
                }
            }
        }
    }

    if !args.dry_run {
        release_lock(&pool).await;
    }

    // Summary
    println!();
    println!("════════════════════════════════════════════════════════════");
    println!();
    if args.dry_run {
        let total_groups = if args.no_genres { 0 } else { groups.len() }
            + if args.no_regions {
                0
            } else {
                region_groups.len()
            };
        println!(
            "{} {} group(s) would be updated",
            "Dry run:".cyan().bold(),
            total_groups
        );
    } else {
        println!(
            "{} {} playlist(s) updated with {} total tracks",
            "Done:".green().bold(),
            total_playlists,
            total_tracks
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(max_tracks: usize, max_per_release: usize) -> GenreConfig {
        GenreConfig {
            max_tracks,
            max_per_release,
            groups: vec![],
        }
    }

    // A big equal-score candidate pool (every artist scored identically) exceeding max_tracks -
    // with a STABLE sort and no pre-sort shuffle, the same top max_tracks subset (by insertion
    // order) would be selected on every single call. Run select_tracks many times and confirm the
    // selected SET of track ids actually rotates (audit #88).
    #[test]
    fn select_tracks_rotates_the_selected_subset_across_runs_on_equal_scores() {
        let n = 40;
        let max_tracks = 10;
        let artist_scores: HashMap<String, f64> =
            (0..n).map(|i| (format!("artist-{i}"), 1.0)).collect();

        let make_tracks = || -> Vec<TrackCandidate> {
            (0..n)
                .map(|i| TrackCandidate {
                    track_id: format!("track-{i}"),
                    artist_id: format!("artist-{i}"),
                    local_release_id: Some(format!("release-{i}")),
                })
                .collect()
        };

        let cfg = config(max_tracks, 1);
        let first: std::collections::HashSet<String> =
            select_tracks(make_tracks(), &artist_scores, &cfg)
                .into_iter()
                .collect();

        let mut saw_a_different_subset = false;
        for _ in 0..30 {
            let selected: std::collections::HashSet<String> =
                select_tracks(make_tracks(), &artist_scores, &cfg)
                    .into_iter()
                    .collect();
            if selected != first {
                saw_a_different_subset = true;
                break;
            }
        }
        assert!(
            saw_a_different_subset,
            "same top-{max_tracks} subset picked every run on a tied score band"
        );
    }

    #[test]
    fn select_tracks_respects_max_tracks_and_max_per_release() {
        let artist_scores: HashMap<String, f64> =
            (0..20).map(|i| (format!("artist-{i}"), 1.0)).collect();
        let tracks: Vec<TrackCandidate> = (0..20)
            .map(|i| TrackCandidate {
                track_id: format!("track-{i}"),
                artist_id: format!("artist-{i}"),
                local_release_id: Some("same-release".to_string()),
            })
            .collect();

        let cfg = config(5, 2);
        let selected = select_tracks(tracks, &artist_scores, &cfg);
        // max_per_release=2 caps every candidate (they all share one release) well below max_tracks=5.
        assert_eq!(selected.len(), 2);
    }

    #[test]
    fn select_tracks_drops_a_track_whose_artist_has_no_score() {
        let artist_scores: HashMap<String, f64> = HashMap::new();
        let tracks = vec![TrackCandidate {
            track_id: "track-1".to_string(),
            artist_id: "unscored-artist".to_string(),
            local_release_id: None,
        }];
        let cfg = config(10, 10);
        assert!(select_tracks(tracks, &artist_scores, &cfg).is_empty());
    }
}
