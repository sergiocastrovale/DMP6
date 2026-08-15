use clap::Parser;
use common::config::{apply_db_overrides, load_config, Config};
use common::db::create_pool;
use common::images::{download_artist_image, record_artist_image};
use common::mb::api::{mb_get_artist_detail, RateLimiter};
use common::mb::types::MbArtistDetail;
use common::progress::Reporter;
use common::s3::create_s3_client;
use reqwest::Client;
use sqlx::PgPool;
use tokio::task::JoinSet;

/// One-off backfill: fetch a photo (Wikidata -> Wikipedia -> Fanart.tv) for every artist that owns a
/// release, isn't merged into another artist via `primaryArtistId`, and currently has no
/// `image`/`imageUrl`. Stores it at `{IMAGE_DIR}/artists/{slug}.jpg` (+ S3 if configured) and, when the
/// artist's on-disk folder is known and has no cover of its own yet, also as
/// `{MUSIC_DIR}/{ArtistFolder}/folder.jpg`.
#[derive(Parser, Debug)]
#[command(name = "artist-photos", about = "Backfill missing artist photos")]
struct Args {
    /// Look up candidates and report what would be fetched, without downloading or writing anything.
    #[arg(long)]
    dry_run: bool,
    /// Cap the number of candidates processed (for a small validation pass before a full run).
    #[arg(long)]
    limit: Option<u32>,
    /// Emit machine-readable PROGRESS: lines for the web terminal.
    #[arg(long)]
    web: bool,
}

#[derive(sqlx::FromRow, Clone)]
struct Candidate {
    id: String,
    slug: String,
    name: String,
    mb_id: String,
    artist_folder: Option<String>,
}

/// How many artist images may download concurrently. MB detail fetches ahead of this stay
/// sequential (rate-limited); Wikidata/Wikipedia/Fanart/the resize+write are not MB calls, so a
/// handful can run at once - same cap `sync` uses for the same reason.
const MAX_IMAGE_TASKS: usize = 4;

#[derive(Default)]
struct Counts {
    downloaded: usize,
    not_found: usize,
    mb_errors: usize,
    would_attempt: usize,
}

async fn fetch_candidates(pool: &PgPool, limit: Option<u32>) -> Vec<Candidate> {
    let limit: i64 = limit.map(|n| n as i64).unwrap_or(i64::MAX);
    sqlx::query_as(
        r#"
        SELECT * FROM (
            SELECT DISTINCT ON (a.id)
                a.id, a.slug, a.name, a."musicbrainzId" AS mb_id,
                split_part(lr."folderPath", '/', 1) AS artist_folder
            FROM "Artist" a
            JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
            JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
            WHERE a."primaryArtistId" IS NULL
              AND a.image IS NULL
              AND a."imageUrl" IS NULL
              AND a."musicbrainzId" IS NOT NULL
            ORDER BY a.id, lr."folderPath" NULLS LAST
        ) c
        ORDER BY c.name
        LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .expect("query candidates")
}

async fn fetch_and_store(
    http_client: Client,
    detail: MbArtistDetail,
    candidate: Candidate,
    s3_client: Option<aws_sdk_s3::Client>,
    config: Config,
    pool: PgPool,
) -> (String, Result<bool, String>) {
    let result = download_artist_image(
        &http_client,
        &detail,
        &candidate.slug,
        candidate.artist_folder.as_deref(),
        &s3_client,
        &config,
    )
    .await;

    if let Ok(true) = result {
        record_artist_image(&pool, &config, &candidate.id, &candidate.slug).await;
    }

    (candidate.name, result)
}

fn report_result(reporter: &Reporter, name: &str, result: &Result<bool, String>, counts: &mut Counts) {
    match result {
        Ok(true) => {
            counts.downloaded += 1;
            reporter.sub_ok(&format!("Downloaded: {}", name));
        }
        Ok(false) => {
            counts.not_found += 1;
            reporter.sub_step(&format!("Not found: {}", name));
        }
        Err(e) => {
            counts.not_found += 1;
            reporter.sub_step(&format!("Error ({}): {}", name, e));
        }
    }
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    common::error_log::init("artist-photos");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    reporter.header(if args.dry_run {
        "DMP Artist Photos (DRY RUN)"
    } else {
        "DMP Artist Photos"
    });

    let candidates = fetch_candidates(&pool, args.limit).await;
    reporter.kv("Candidates", &candidates.len().to_string());

    let s3_client = create_s3_client(&config).await;
    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP client");

    let mut limiter = RateLimiter::new();
    limiter.set_web(args.web);
    let mut counts = Counts::default();
    let mut image_tasks: JoinSet<(String, Result<bool, String>)> = JoinSet::new();

    for candidate in candidates {
        reporter.step(&format!("Fetching MB detail: {}", candidate.name));
        let detail = match mb_get_artist_detail(&http_client, &candidate.mb_id, &mut limiter).await {
            Ok(d) => d,
            Err(e) => {
                counts.mb_errors += 1;
                reporter.sub_step(&format!("MB detail error ({}): {}", candidate.name, e));
                continue;
            }
        };

        if args.dry_run {
            let has_relation_source = detail
                .relations
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .any(|r| matches!(r.relation_type.as_str(), "wikidata" | "wikipedia"));
            let has_source = has_relation_source || config.fanart_api_key.is_some();
            if has_source {
                counts.would_attempt += 1;
            }
            reporter.sub_step(&format!(
                "{} -> {}",
                candidate.name,
                if has_source { "candidate source found" } else { "no source available" }
            ));
            continue;
        }

        while image_tasks.len() >= MAX_IMAGE_TASKS {
            if let Some(Ok((name, result))) = image_tasks.join_next().await {
                report_result(&reporter, &name, &result, &mut counts);
            }
        }
        image_tasks.spawn(fetch_and_store(
            http_client.clone(),
            detail,
            candidate,
            s3_client.clone(),
            config.clone(),
            pool.clone(),
        ));
    }

    while let Some(res) = image_tasks.join_next().await {
        if let Ok((name, result)) = res {
            report_result(&reporter, &name, &result, &mut counts);
        }
    }

    reporter.blank();
    if args.dry_run {
        reporter.done(&format!(
            "Dry run done. {} candidate(s) with a source available, {} MB detail error(s).",
            counts.would_attempt, counts.mb_errors
        ));
    } else {
        reporter.done(&format!(
            "Done. {} downloaded, {} not found, {} MB detail error(s).",
            counts.downloaded, counts.not_found, counts.mb_errors
        ));
    }
}
