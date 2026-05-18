use aws_sdk_s3::Client as S3Client;
use common::config::Config;
use common::filters::matches_filter;
use common::s3::delete_from_s3;
use sqlx::PgPool;
use std::path::PathBuf;

pub async fn nuke_mb_data(
    pool: &PgPool,
    from: Option<&str>,
    to: Option<&str>,
    only: Option<&str>,
    exact: bool,
    _project_root: &str,
    s3_client: &Option<S3Client>,
    config: &Config,
) -> Result<u64, sqlx::Error> {
    let artists: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, name FROM "Artist""#,
    )
    .fetch_all(pool)
    .await?;

    let mut deleted = 0u64;

    for (id, name) in &artists {
        if !matches_filter(
            name,
            from.unwrap_or(""),
            to.unwrap_or(""),
            only.unwrap_or(""),
            exact,
        ) {
            continue;
        }

        // Delete cover images for all MB releases linked to this artist
        let mb_release_ids: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT mbr.id, mbr."musicbrainzId"
               FROM "MusicBrainzRelease" mbr
               JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mbr.id
               WHERE mra."artistId" = $1"#,
        )
        .bind(&id)
        .fetch_all(pool)
        .await?;

        for (_, mb_id) in &mb_release_ids {
            let local_path = PathBuf::from(&config.image_dir)
                .join("releases")
                .join(format!("{}.jpg", mb_id));
            if local_path.exists() {
                let _ = std::fs::remove_file(&local_path);
            }
            if let (Some(ref client), Some(ref bucket)) = (s3_client, &config.s3_bucket) {
                delete_from_s3(client, bucket, &format!("releases/{}.jpg", mb_id)).await;
            }
        }

        // Unlink LocalReleases from MB (set releaseId = NULL, reset status)
        for (mb_db_id, _) in &mb_release_ids {
            sqlx::query(
                r#"UPDATE "LocalRelease"
                   SET "releaseId" = NULL,
                       "matchStatus" = 'UNKNOWN'::"ReleaseStatus",
                       "statusReason" = NULL
                   WHERE "releaseId" = $1"#,
            )
            .bind(mb_db_id)
            .execute(pool)
            .await?;
        }

        // Delete MB release artist links for this artist
        sqlx::query(
            r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#,
        )
        .bind(&id)
        .execute(pool)
        .await?;

        // Delete MB releases that now have no artist links
        sqlx::query(
            r#"DELETE FROM "MusicBrainzRelease"
               WHERE id NOT IN (SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist")"#,
        )
        .execute(pool)
        .await?;

        // Reset artist MB fields and lastSyncedAt
        sqlx::query(
            r#"UPDATE "Artist"
               SET "musicbrainzId" = NULL,
                   "averageMatchScore" = NULL,
                   "lastSyncedAt" = NULL,
                   "updatedAt" = NOW()
               WHERE id = $1"#,
        )
        .bind(&id)
        .execute(pool)
        .await?;

        deleted += 1;
    }

    Ok(deleted)
}
