use chrono::Utc;
use clap::Parser;
use colored::*;
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
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

    /// Update only a specific generator (by slug)
    #[arg(long)]
    group: Option<String>,

    /// Skip genre playlists
    #[arg(long)]
    no_genres: bool,

    /// Skip region playlists
    #[arg(long)]
    no_regions: bool,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Selection knobs, formerly the top-level fields of genre-groups.json. Now that groups live in
// the DB (`PlaylistGenerator`, editable at /playlists/setup/generated), these are plain constants
// - they were never actually varied per-deployment.
const MAX_TRACKS: usize = 500;
const MAX_PER_RELEASE: usize = 3;
const MIN_TRACKS: usize = 10;

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

// ---------------------------------------------------------------------------
// Generators (DB-backed config, see PlaylistGenerator in prisma/schema.prisma)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Generator {
    id: String,
    kind: String, // "GENRE" | "REGION"
    name: String,
    slug: String,
    description: Option<String>,
    terms: Vec<String>,
}

async fn fetch_generators(pool: &PgPool) -> Vec<Generator> {
    let rows: Vec<(String, String, String, String, Option<String>, Vec<String>)> = sqlx::query_as(
        r#"SELECT id, type::text, name, slug, description, terms FROM "PlaylistGenerator" ORDER BY type, name"#,
    )
    .fetch_all(pool)
    .await
    .expect("Failed to fetch playlist generators");

    rows.into_iter()
        .map(|(id, kind, name, slug, description, terms)| Generator {
            id,
            kind,
            name,
            slug,
            description,
            terms,
        })
        .collect()
}

/// A GENRE generator's terms, split into keyword lines and `-`-prefixed exclude lines.
#[derive(Debug, Default)]
struct GenreRule {
    keywords: Vec<String>,
    excludes: Vec<String>,
}

impl GenreRule {
    fn from_terms(terms: &[String]) -> Self {
        let mut keywords = Vec::new();
        let mut excludes = Vec::new();
        for raw in terms {
            let t = raw.trim();
            if t.is_empty() {
                continue;
            }
            if let Some(rest) = t.strip_prefix('-') {
                let rest = rest.trim();
                if !rest.is_empty() {
                    excludes.push(rest.to_lowercase());
                }
            } else {
                keywords.push(t.to_lowercase());
            }
        }
        GenreRule { keywords, excludes }
    }
}

/// A REGION generator's terms, as uppercased ISO 3166-1 alpha-2 country codes.
fn region_countries(terms: &[String]) -> Vec<String> {
    terms
        .iter()
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .collect()
}

// ---------------------------------------------------------------------------
// Genre Matching
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct GenreMatch {
    genre_id: String,
    weight: f64,
}

/// Match a genre name against a genre rule, returning a weight (0.0 = no match, 1.0 = exact
/// keyword). Two tiers only - exact and whole-word - now that groups are hand-edited via a plain
/// textarea rather than tuned includes/excludes/substring lists.
fn match_genre(genre_name: &str, rule: &GenreRule) -> Option<f64> {
    let name_lower = genre_name.to_lowercase();

    if rule.excludes.contains(&name_lower) {
        return None;
    }

    if rule.keywords.contains(&name_lower) {
        return Some(1.0);
    }

    if rule
        .keywords
        .iter()
        .any(|kw| contains_as_word(&name_lower, kw))
    {
        return Some(0.8);
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
            // Advance by one whole character, not one byte: a multi-byte UTF-8 character at
            // `abs_pos` (e.g. an accented letter) would otherwise leave `start` mid-character, and
            // the next `haystack[start..]` slice panics ("byte index is not a char boundary").
            let advance = haystack[abs_pos..]
                .chars()
                .next()
                .map_or(1, |c| c.len_utf8());
            start = abs_pos + advance;
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

async fn fetch_artist_genre_links(
    pool: &PgPool,
    genre_ids: &[String],
) -> Result<Vec<(String, String)>, sqlx::Error> {
    if genre_ids.is_empty() {
        return Ok(vec![]);
    }
    // _ArtistGenres: "A" = artist_id, "B" = genre_id. Same primaryArtistId rule as
    // fetch_tracks_for_countries: a connected (duplicate-merged) artist is excluded here too, or its
    // own genre links score it as a second, separate artist alongside the canonical one it was
    // connected to.
    sqlx::query_as::<_, (String, String)>(
        r#"SELECT ag."A", ag."B"
           FROM "_ArtistGenres" ag
           JOIN "Artist" a ON a.id = ag."A"
           WHERE ag."B" = ANY($1) AND a."primaryArtistId" IS NULL"#,
    )
    .bind(genre_ids)
    .fetch_all(pool)
    .await
}

#[derive(Debug)]
struct TrackCandidate {
    track_id: String,
    artist_id: String,
    local_release_id: Option<String>,
}

async fn fetch_tracks_for_artists(
    pool: &PgPool,
    artist_ids: &[String],
) -> Result<Vec<TrackCandidate>, sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(vec![]);
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
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(track_id, artist_id, local_release_id, _genre)| TrackCandidate {
                track_id,
                artist_id,
                local_release_id,
            },
        )
        .collect())
}

async fn fetch_tracks_for_countries(
    pool: &PgPool,
    country_codes: &[String],
) -> Result<Vec<TrackCandidate>, sqlx::Error> {
    if country_codes.is_empty() {
        return Ok(vec![]);
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
    .await?;

    Ok(rows
        .into_iter()
        .map(|(track_id, artist_id, local_release_id)| TrackCandidate {
            track_id,
            artist_id,
            local_release_id,
        })
        .collect())
}

/// A generator that currently matches nothing must not leave a stale or empty playlist behind -
/// `Playlist.generatorId` cascades, so this also drops its `PlaylistTrack` rows. No-op if the
/// generator has never produced a playlist (nothing to prune yet).
async fn prune_playlist(pool: &PgPool, generator_id: &str) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(r#"DELETE FROM "Playlist" WHERE "generatorId" = $1"#)
        .bind(generator_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Called from every early-exit in the generation loops (no matches, too few tracks): prunes this
/// generator's existing playlist so a rule that stops qualifying doesn't leave stale tracks or an
/// empty shell behind forever. `--dry-run` only reports what would be pruned.
async fn prune_if_stale(pool: &PgPool, generator: &Generator, dry_run: bool) {
    if dry_run {
        return;
    }
    match prune_playlist(pool, &generator.id).await {
        Ok(0) => {}
        Ok(_) => println!("    {} pruned stale playlist", "↩".yellow()),
        Err(e) => println!("    {} failed to prune: {}", "✗".red(), e),
    }
}

async fn upsert_playlist(
    pool: &PgPool,
    generator: &Generator,
    track_ids: &[String],
) -> Result<(), sqlx::Error> {
    let prefix = if generator.kind == "REGION" {
        "region"
    } else {
        "genre"
    };
    let playlist_slug = format!("{}-{}", prefix, generator.slug);

    let existing: Option<(String,)> =
        sqlx::query_as(r#"SELECT id FROM "Playlist" WHERE "generatorId" = $1"#)
            .bind(&generator.id)
            .fetch_optional(pool)
            .await?;

    let playlist_id = if let Some((id,)) = existing {
        // Update existing playlist
        sqlx::query(
            r#"UPDATE "Playlist" SET name = $1, slug = $2, description = $3, "updatedAt" = NOW() WHERE id = $4"#,
        )
        .bind(&generator.name)
        .bind(&playlist_slug)
        .bind(&generator.description)
        .bind(&id)
        .execute(pool)
        .await?;
        id
    } else {
        // Create new playlist
        let id = generate_cuid();
        sqlx::query(
            r#"INSERT INTO "Playlist" (id, name, slug, description, type, "generatorId", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5::"PlaylistType", $6, NOW(), NOW())"#,
        )
        .bind(&id)
        .bind(&generator.name)
        .bind(&playlist_slug)
        .bind(&generator.description)
        .bind(&generator.kind)
        .bind(&generator.id)
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
        .bind(vec![Utc::now().naive_utc(); track_ids.len()])
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
    max_tracks: usize,
    max_per_release: usize,
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
        if selected.len() >= max_tracks {
            break;
        }
        if let Some(ref release_id) = track.release_id {
            let count = release_counts.entry(release_id.clone()).or_insert(0);
            if *count >= max_per_release {
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

// ---------------------------------------------------------------------------
// Report Mode
// ---------------------------------------------------------------------------

fn print_report(genres: &[(String, String)], generators: &[Generator]) {
    println!("{}", "Genre Assignment Report".bold());
    println!("{}", "=".repeat(70));
    println!();

    let genre_generators: Vec<(&Generator, GenreRule)> = generators
        .iter()
        .filter(|g| g.kind == "GENRE")
        .map(|g| (g, GenreRule::from_terms(&g.terms)))
        .collect();

    // Build genre → groups mapping
    let mut genre_assignments: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    let mut unmatched: Vec<String> = Vec::new();

    for (_, genre_name) in genres {
        let mut matches = Vec::new();
        for (generator, rule) in &genre_generators {
            if let Some(weight) = match_genre(genre_name, rule) {
                matches.push((generator.name.clone(), weight));
            }
        }
        if matches.is_empty() {
            unmatched.push(genre_name.clone());
        } else {
            genre_assignments.insert(genre_name.clone(), matches);
        }
    }

    // Print assigned genres by group
    for (generator, _) in &genre_generators {
        let mut group_genres: Vec<(&String, f64)> = Vec::new();
        for (genre_name, assignments) in &genre_assignments {
            for (group_name, weight) in assignments {
                if group_name == &generator.name {
                    group_genres.push((genre_name, *weight));
                }
            }
        }
        group_genres.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(b.0)));

        println!(
            "{} {} ({} genres)",
            "●".cyan(),
            generator.name.bold(),
            group_genres.len()
        );

        for (genre_name, weight) in &group_genres {
            let weight_label = match *weight {
                w if w >= 1.0 => "exact".green(),
                _ => "word".bright_green(),
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

    println!("DMP Generated Playlists");
    println!("========================");
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

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&app_config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    let all_generators = fetch_generators(&pool).await;
    println!(
        "Config: {} playlist generators (from the database, see /playlists/setup/generated)",
        all_generators.len(),
    );
    println!();

    // Fetch all genres
    let all_genres = fetch_all_genres(&pool).await;
    println!(
        "  {} {} genres in database",
        "→".bright_black(),
        all_genres.len()
    );

    // Filter generators if --group is specified
    let generators: Vec<&Generator> = if let Some(ref group_slug) = args.group {
        let filtered: Vec<&Generator> = all_generators
            .iter()
            .filter(|g| &g.slug == group_slug)
            .collect();
        if filtered.is_empty() {
            let all_slugs: Vec<&str> = all_generators.iter().map(|g| g.slug.as_str()).collect();
            common::error_log::log_error(&format!("No group found with slug '{}'", group_slug));
            eprintln!(
                "{} No group found with slug '{}'. Available: {}",
                "✗".red(),
                group_slug,
                all_slugs.join(", ")
            );
            std::process::exit(1);
        }
        filtered
    } else {
        all_generators.iter().collect()
    };

    let genre_generators: Vec<&Generator> = generators
        .iter()
        .filter(|g| g.kind == "GENRE")
        .copied()
        .collect();
    let region_generators: Vec<&Generator> = generators
        .iter()
        .filter(|g| g.kind == "REGION")
        .copied()
        .collect();

    // Report mode: just show assignments and exit
    if args.report {
        println!();
        print_report(&all_genres, &all_generators);
        return;
    }

    // Same DB scan lock index/sync/fix/delete/nuke use - regen mutates PlaylistTrack rows and reads
    // artist/genre/track tables that index/sync are actively writing, so a concurrent run of either
    // could otherwise interleave with this pass (audit #89, pairs #51). Skipped for --dry-run, which
    // never writes.
    let _lock_guard = if !args.dry_run {
        if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
            println!("{}", "Cleared a stale lock.".yellow());
        }
        match acquire_lock(&pool, "playlists", std::process::id()).await {
            Ok(g) => Some(g),
            Err(e) => {
                eprintln!("{}: {}", "Cannot start".red(), e);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    println!();

    let mut total_playlists = 0;
    let mut total_tracks = 0;

    // --- Genre playlists ---
    if !args.no_genres && !genre_generators.is_empty() {
        println!("  {} {}", "▸".bright_black(), "Genre Playlists".bold());
        println!();

        for generator in &genre_generators {
            print!("  {} {}... ", "●".cyan(), generator.name.bold());

            let rule = GenreRule::from_terms(&generator.terms);

            let genre_matches: Vec<GenreMatch> = all_genres
                .iter()
                .filter_map(|(id, name)| {
                    match_genre(name, &rule).map(|weight| GenreMatch {
                        genre_id: id.clone(),
                        weight,
                    })
                })
                .collect();

            if genre_matches.is_empty() {
                println!("{} no matching genres", "○".bright_black());
                prune_if_stale(&pool, generator, args.dry_run).await;
                continue;
            }

            let genre_weights: HashMap<String, f64> = genre_matches
                .iter()
                .map(|m| (m.genre_id.clone(), m.weight))
                .collect();

            let genre_ids: Vec<String> = genre_matches.iter().map(|m| m.genre_id.clone()).collect();
            let artist_links = common::lock::expect_or_release(
                &pool,
                "playlists",
                std::process::id(),
                fetch_artist_genre_links(&pool, &genre_ids).await,
                "Failed to fetch artist-genre links",
            )
            .await;

            if artist_links.is_empty() {
                println!("{} no artists with matching genres", "○".bright_black());
                prune_if_stale(&pool, generator, args.dry_run).await;
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
            let tracks = common::lock::expect_or_release(
                &pool,
                "playlists",
                std::process::id(),
                fetch_tracks_for_artists(&pool, &artist_ids).await,
                "Failed to fetch tracks",
            )
            .await;

            if tracks.is_empty() {
                println!("{} no tracks found", "○".bright_black());
                prune_if_stale(&pool, generator, args.dry_run).await;
                continue;
            }

            let selected = select_tracks(tracks, &artist_scores, MAX_TRACKS, MAX_PER_RELEASE);

            if selected.len() < MIN_TRACKS {
                println!(
                    "{} only {} tracks (min {} required, skipping)",
                    "○".bright_black(),
                    selected.len(),
                    MIN_TRACKS
                );
                prune_if_stale(&pool, generator, args.dry_run).await;
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
                match upsert_playlist(&pool, generator, &selected).await {
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
    if !args.no_regions && !region_generators.is_empty() {
        println!();
        println!("  {} {}", "▸".bright_black(), "Region Playlists".bold());
        println!();

        for generator in &region_generators {
            print!("  {} {}... ", "●".magenta(), generator.name.bold());

            let countries = region_countries(&generator.terms);
            let tracks = common::lock::expect_or_release(
                &pool,
                "playlists",
                std::process::id(),
                fetch_tracks_for_countries(&pool, &countries).await,
                "Failed to fetch tracks for countries",
            )
            .await;

            if tracks.is_empty() {
                println!("{} no tracks found", "○".bright_black());
                prune_if_stale(&pool, generator, args.dry_run).await;
                continue;
            }

            let artist_scores: HashMap<String, f64> =
                tracks.iter().map(|t| (t.artist_id.clone(), 1.0)).collect();
            let selected = select_tracks(tracks, &artist_scores, MAX_TRACKS, MAX_PER_RELEASE);

            if selected.len() < MIN_TRACKS {
                println!(
                    "{} only {} tracks (min {} required, skipping)",
                    "○".bright_black(),
                    selected.len(),
                    MIN_TRACKS
                );
                prune_if_stale(&pool, generator, args.dry_run).await;
                continue;
            }

            if args.dry_run {
                println!(
                    "{} {} countries, {} tracks (dry run)",
                    "○".magenta(),
                    countries.len(),
                    selected.len()
                );
            } else {
                match upsert_playlist(&pool, generator, &selected).await {
                    Ok(_) => {
                        println!(
                            "{} {} countries, {} tracks",
                            "✓".green(),
                            countries.len(),
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
        release_lock(&pool, "playlists", std::process::id()).await;
    }

    // Summary
    println!();
    println!("════════════════════════════════════════════════════════════");
    println!();
    if args.dry_run {
        let total_groups = if args.no_genres {
            0
        } else {
            genre_generators.len()
        } + if args.no_regions {
            0
        } else {
            region_generators.len()
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

    // A rejected match immediately followed by a multi-byte character used to advance the search
    // by one byte, landing mid-character - the next slice then panicked with "byte index is not a
    // char boundary" instead of just continuing the search.
    #[test]
    fn contains_as_word_does_not_panic_on_multi_byte_characters() {
        assert!(!contains_as_word("coéxist", "é"));
        assert!(contains_as_word("café", "café"));
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

        let first: std::collections::HashSet<String> =
            select_tracks(make_tracks(), &artist_scores, max_tracks, 1)
                .into_iter()
                .collect();

        let mut saw_a_different_subset = false;
        for _ in 0..30 {
            let selected: std::collections::HashSet<String> =
                select_tracks(make_tracks(), &artist_scores, max_tracks, 1)
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

        let selected = select_tracks(tracks, &artist_scores, 5, 2);
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
        assert!(select_tracks(tracks, &artist_scores, 10, 10).is_empty());
    }

    #[test]
    fn genre_rule_splits_plain_and_dash_prefixed_lines() {
        let terms = vec![
            "Rock".to_string(),
            " grunge ".to_string(),
            "".to_string(),
            "-Indie Rock".to_string(),
            "- indie pop".to_string(),
            "-".to_string(),
        ];
        let rule = GenreRule::from_terms(&terms);
        assert_eq!(rule.keywords, vec!["rock", "grunge"]);
        assert_eq!(rule.excludes, vec!["indie rock", "indie pop"]);
    }

    #[test]
    fn match_genre_exact_and_whole_word_tiers() {
        let rule = GenreRule::from_terms(&["rock".to_string()]);
        assert_eq!(match_genre("Rock", &rule), Some(1.0));
        assert_eq!(match_genre("classic rock", &rule), Some(0.8));
        assert_eq!(match_genre("hard rock", &rule), Some(0.8));
    }

    #[test]
    fn match_genre_no_longer_matches_bare_substrings() {
        // The old 0.4 substring tier is gone - "electro" must not match "electronica".
        let rule = GenreRule::from_terms(&["electro".to_string()]);
        assert_eq!(match_genre("electronica", &rule), None);
    }

    #[test]
    fn match_genre_exclude_wins_over_keyword_match() {
        let rule = GenreRule::from_terms(&["rock".to_string(), "-indie rock".to_string()]);
        assert_eq!(match_genre("indie rock", &rule), None);
        assert_eq!(match_genre("hard rock", &rule), Some(0.8));
    }

    #[test]
    fn region_countries_uppercases_and_drops_blank_lines() {
        let terms = vec!["jp".to_string(), " Kr ".to_string(), "".to_string()];
        assert_eq!(region_countries(&terms), vec!["JP", "KR"]);
    }
}
