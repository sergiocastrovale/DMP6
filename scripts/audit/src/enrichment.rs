use cuid2::create_id;
use sqlx::PgPool;

/// One transaction for the whole pass - a crash between the DELETE and the last INSERT used to
/// leave the DETECTED set empty/partial until the next run re-derives it (PENDING/RESOLVED/FAILED
/// rows are untouched either way, so nothing is permanently lost, but a run that dies partway used to
/// silently under-report instead of reporting none).
pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueEnrichmentGap" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    // One row per LocalRelease. Each boolean is true when NO track in the release has that field.
    // Only considers releases that have at least one track.
    let rows: Vec<(String, bool, bool, bool, bool, bool, bool, bool)> = sqlx::query_as(
        r#"
        WITH release_enrichment AS (
          SELECT
            lr.id,
            -- MusicBrainz: release not linked to MB
            lr."releaseId" IS NULL AS missing_mb,
            -- BPM: no track has any BPM key
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND (t.metadata ? 'IntegerBpm' OR t.metadata ? 'BPM' OR t.metadata ? 'Bpm'
                     OR t.metadata ? 'FBPM' OR t.metadata ? 'fBPM' OR t.metadata ? 'fBPM2')
            ) AS missing_bpm,
            -- Mood: no track has any MOOD_* key
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND t.metadata IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM jsonb_object_keys(t.metadata) k WHERE k ~ '^MOOD_'
                )
            ) AS missing_mood,
            -- AcousticID: no track has an acoustid key
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND (t.metadata ? 'acoustid_id' OR t.metadata ? 'Acoustid Id'
                     OR t.metadata ? 'ACOUSTID_ID' OR t.metadata ? 'Acoustid Fingerprint'
                     OR t.metadata ? 'ACOUSTID_FINGERPRINT')
            ) AS missing_acousticid,
            -- Discogs: no track has a Discogs URL tag
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND (t.metadata ? 'WWW DISCOGS_ARTIST' OR t.metadata ? 'WWW DISCOGS_RELEASE')
            ) AS missing_discogs,
            -- Bandcamp: no track has a Bandcamp URL tag
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND t.metadata ? 'WWW BANDCAMP_ARTIST'
            ) AS missing_bandcamp,
            -- Wikipedia: no track has a Wikipedia URL tag
            NOT EXISTS (
              SELECT 1 FROM "LocalReleaseTrack" t
              WHERE t."localReleaseId" = lr.id
                AND t.metadata ? 'WWW WIKIPEDIA_ARTIST'
            ) AS missing_wikipedia
          FROM "LocalRelease" lr
          WHERE EXISTS (
            SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
          )
        )
        SELECT id, missing_mb, missing_bpm, missing_mood, missing_acousticid,
               missing_discogs, missing_bandcamp, missing_wikipedia
        FROM release_enrichment
        WHERE missing_mb OR missing_bpm OR missing_mood OR missing_acousticid
           OR missing_discogs OR missing_bandcamp OR missing_wikipedia
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    // One read for every already-tracked release instead of a round trip per candidate below.
    let candidate_ids: Vec<&str> = rows.iter().map(|(id, ..)| id.as_str()).collect();
    let already_tracked_ids: std::collections::HashSet<String> = sqlx::query_scalar(
        r#"SELECT "localReleaseId" FROM "IssueEnrichmentGap"
           WHERE "localReleaseId" = ANY($1::text[]) AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
    )
    .bind(&candidate_ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    for (
        release_id,
        missing_mb,
        missing_bpm,
        missing_mood,
        missing_acousticid,
        missing_discogs,
        missing_bandcamp,
        missing_wikipedia,
    ) in &rows
    {
        let mut missing_fields: Vec<&str> = Vec::new();
        if *missing_mb {
            missing_fields.push("mbRelease");
        }
        if *missing_bpm {
            missing_fields.push("bpm");
        }
        if *missing_mood {
            missing_fields.push("mood");
        }
        if *missing_acousticid {
            missing_fields.push("acousticId");
        }
        if *missing_discogs {
            missing_fields.push("discogs");
        }
        if *missing_bandcamp {
            missing_fields.push("bandcamp");
        }
        if *missing_wikipedia {
            missing_fields.push("wikipedia");
        }

        if already_tracked_ids.contains(release_id) {
            continue;
        }

        let id = create_id();
        sqlx::query(
            r#"INSERT INTO "IssueEnrichmentGap"
               (id, "auditRunId", status, "localReleaseId", "missingFields", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $5)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(release_id)
        .bind(&missing_fields)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    tx.commit().await?;
    Ok(inserted)
}
