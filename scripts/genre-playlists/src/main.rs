use chrono::Utc;
use clap::Parser;
use colored::*;
use rand::SeedableRng;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "dmp-genre-playlists", about = "Generate genre-based playlists from MusicBrainz genres")]
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

struct AppConfig {
    database_url: String,
}

fn load_env() -> AppConfig {
    let env_paths = [
        PathBuf::from("web/.env"),
        PathBuf::from("../../web/.env"),
    ];

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
            PathBuf::from("scripts/genre-playlists/genre-groups.json"),
            PathBuf::from("genre-groups.json"),
            PathBuf::from("../../scripts/genre-playlists/genre-groups.json"),
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
        config_paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
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
    genre: Option<String>,
}

async fn fetch_tracks_for_artists(pool: &PgPool, artist_ids: &[String]) -> Vec<TrackCandidate> {
    if artist_ids.is_empty() {
        return vec![];
    }
    // Fetch tracks for artists with PRIMARY or ALBUM_ARTIST role
    let rows: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT DISTINCT lrt.id, ta."artistId", lrt."localReleaseId", lrt.genre
        FROM "LocalReleaseTrack" lrt
        JOIN "TrackArtist" ta ON ta."trackId" = lrt.id
        WHERE ta."artistId" = ANY($1)
          AND ta.role IN ('PRIMARY', 'ALBUM_ARTIST')
          AND lrt."localReleaseId" IS NOT NULL
          AND lrt.title IS NOT NULL
        "#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await
    .expect("Failed to fetch tracks");

    rows.into_iter()
        .map(|(track_id, artist_id, local_release_id, genre)| TrackCandidate {
            track_id,
            artist_id,
            local_release_id,
            genre,
        })
        .collect()
}

async fn upsert_playlist(
    pool: &PgPool,
    group: &GenreGroup,
    track_ids: &[String],
) -> Result<(), sqlx::Error> {
    let playlist_slug = format!("genre-{}", group.slug);

    // Check if playlist exists
    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Playlist" WHERE "genreGroup" = $1"#,
    )
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

    // Clear existing tracks
    sqlx::query(r#"DELETE FROM "PlaylistTrack" WHERE "playlistId" = $1"#)
        .bind(&playlist_id)
        .execute(pool)
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
        .execute(pool)
        .await?;
    }

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
    group: &GenreGroup,
    config: &GenreConfig,
) -> Vec<String> {
    let mut scored: Vec<ScoredTrack> = tracks
        .into_iter()
        .filter_map(|t| {
            let artist_score = artist_scores.get(&t.artist_id)?;
            let mut score = *artist_score;

            // Small bonus if track's own ID3 genre field matches
            if let Some(ref genre_str) = t.genre {
                let genre_lower = genre_str.to_lowercase();
                for root in &group.roots {
                    if genre_lower.contains(&root.to_lowercase()) {
                        score += 0.05;
                        break;
                    }
                }
            }

            Some(ScoredTrack {
                track_id: t.track_id,
                release_id: t.local_release_id,
                score,
            })
        })
        .collect();

    // Deduplicate by track_id, keeping highest score
    // (a track can appear multiple times via different artist roles)
    scored.sort_by(|a, b| {
        a.track_id.cmp(&b.track_id)
            .then(b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
    });
    scored.dedup_by(|a, b| a.track_id == b.track_id);

    // Shuffle within same score tier using date-seeded RNG
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let seed_str = format!("{}-{}", group.slug, today);
    let seed = {
        let mut hash: u64 = 0;
        for b in seed_str.as_bytes() {
            hash = hash.wrapping_mul(31).wrapping_add(*b as u64);
        }
        hash
    };
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);

    // Add small random perturbation within tier (0.001 range so it doesn't cross tiers)
    for track in &mut scored {
        use rand::Rng;
        let jitter: f64 = rng.gen::<f64>() * 0.001;
        track.score += jitter;
    }

    // Sort by score descending
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Enforce max per release
    let mut release_counts: HashMap<String, usize> = HashMap::new();
    let mut selected = Vec::new();

    for track in scored {
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

fn print_report(
    genres: &[(String, String)],
    groups: &[GenreGroup],
) {
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

    println!("DMP Genre Playlists");
    println!("===================");
    if args.dry_run {
        println!("Mode: {} (no changes will be made)", "DRY RUN".yellow().bold());
    }
    if args.report {
        println!("Mode: {}", "REPORT".cyan().bold());
    }
    println!();

    // Load config
    let app_config = load_env();
    let genre_config = load_genre_config(args.config.as_deref());

    println!(
        "Config: {} groups, max {} tracks/playlist, max {} tracks/release",
        genre_config.groups.len(),
        genre_config.max_tracks,
        genre_config.max_per_release
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
    println!("  {} {} genres in database", "→".bright_black(), all_genres.len());

    // Filter groups if --group is specified
    let groups: Vec<&GenreGroup> = if let Some(ref group_slug) = args.group {
        let filtered: Vec<&GenreGroup> = genre_config
            .groups
            .iter()
            .filter(|g| g.slug == *group_slug)
            .collect();
        if filtered.is_empty() {
            eprintln!(
                "{} No genre group found with slug '{}'. Available: {}",
                "✗".red(),
                group_slug,
                genre_config.groups.iter().map(|g| g.slug.as_str()).collect::<Vec<_>>().join(", ")
            );
            std::process::exit(1);
        }
        filtered
    } else {
        genre_config.groups.iter().collect()
    };

    // Report mode: just show assignments and exit
    if args.report {
        println!();
        print_report(
            &all_genres,
            &genre_config.groups,
        );
        return;
    }

    println!();

    // Process each genre group
    let mut total_playlists = 0;
    let mut total_tracks = 0;

    for group in &groups {
        print!("  {} {}... ", "●".cyan(), group.name.bold());

        // 1. Match genres
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

        // 2. Build genre_id → weight map
        let genre_weights: HashMap<String, f64> = genre_matches
            .iter()
            .map(|m| (m.genre_id.clone(), m.weight))
            .collect();

        // 3. Fetch artist-genre links for matching genres
        let genre_ids: Vec<String> = genre_matches.iter().map(|m| m.genre_id.clone()).collect();
        let artist_links = fetch_artist_genre_links(&pool, &genre_ids).await;

        if artist_links.is_empty() {
            println!("{} no artists with matching genres", "○".bright_black());
            continue;
        }

        // 4. Score artists (max weight across matching genres)
        let mut artist_scores: HashMap<String, f64> = HashMap::new();
        for (artist_id, genre_id) in &artist_links {
            if let Some(&weight) = genre_weights.get(genre_id) {
                let entry = artist_scores.entry(artist_id.clone()).or_insert(0.0);
                if weight > *entry {
                    *entry = weight;
                }
            }
        }

        // 5. Fetch tracks for scored artists
        let artist_ids: Vec<String> = artist_scores.keys().cloned().collect();
        let tracks = fetch_tracks_for_artists(&pool, &artist_ids).await;

        if tracks.is_empty() {
            println!("{} no tracks found", "○".bright_black());
            continue;
        }

        // 6. Select top tracks
        let selected = select_tracks(tracks, &artist_scores, group, &genre_config);

        if selected.len() < 10 {
            println!(
                "{} only {} tracks (min 10 required, skipping)",
                "○".bright_black(),
                selected.len()
            );
            continue;
        }

        // 7. Upsert playlist
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

    // Summary
    println!();
    println!("════════════════════════════════════════════════════════════");
    println!();
    if args.dry_run {
        println!("{} {} group(s) would be updated", "Dry run:".cyan().bold(), groups.len());
    } else {
        println!(
            "{} {} playlist(s) updated with {} total tracks",
            "Done:".green().bold(),
            total_playlists,
            total_tracks
        );
    }
}
