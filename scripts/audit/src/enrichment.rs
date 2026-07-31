use cuid2::create_id;
use sqlx::PgPool;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueEnrichmentGap" WHERE status = 'DETECTED'"#)
        .execute(pool)
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
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    for (release_id, missing_mb, missing_bpm, missing_mood, missing_acousticid,
         missing_discogs, missing_bandcamp, missing_wikipedia) in &rows
    {
        let mut missing_fields: Vec<&str> = Vec::new();
        if *missing_mb { missing_fields.push("mbRelease"); }
        if *missing_bpm { missing_fields.push("bpm"); }
        if *missing_mood { missing_fields.push("mood"); }
        if *missing_acousticid { missing_fields.push("acousticId"); }
        if *missing_discogs { missing_fields.push("discogs"); }
        if *missing_bandcamp { missing_fields.push("bandcamp"); }
        if *missing_wikipedia { missing_fields.push("wikipedia"); }

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueEnrichmentGap"
               WHERE "localReleaseId" = $1 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(release_id)
        .fetch_one(pool)
        .await?;
        if already_tracked {
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
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}
