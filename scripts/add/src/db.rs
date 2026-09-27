use sqlx::PgPool;

/// An existing Artist row that blocks `./add` from creating a new one, resolved to whichever slug the
/// caller should be told about - the primary artist's, if the match is a connected duplicate.
pub struct ExistingArtist {
    pub name: String,
    pub slug: String,
}

/// Looks for an existing Artist by MusicBrainz id (any row, including a connected duplicate that
/// isn't itself the primary - resolved up to its `primaryArtistId`). Only the id counts: another artist
/// with the same name is a homonym, not this artist (crate::homonym).
pub async fn find_existing_artist(pool: &PgPool, mb_id: &str) -> Result<Option<ExistingArtist>, sqlx::Error> {
    let row: Option<(String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(p.name, a.name), COALESCE(p.slug, a.slug)
           FROM "Artist" a
           LEFT JOIN "Artist" p ON p.id = a."primaryArtistId"
           WHERE a."musicbrainzId" = $1
           LIMIT 1"#,
    )
    .bind(mb_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(name, slug)| ExistingArtist { name, slug }))
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_artist(
    pool: &PgPool,
    id: &str,
    name: &str,
    slug: &str,
    base_slug: &str,
    mb_id: &str,
    country: Option<&str>,
    disambiguation: Option<&str>,
    monitored: bool,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "Artist"
             (id, name, slug, "baseSlug", "musicbrainzId", country, disambiguation, "manuallyAdded", monitored,
              "totalTracks", "totalFileSize", "lastSyncedAt", "lastGapsCheckedAt",
              "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $8, $4, $5, NULLIF($9, ''), true, $6, 0, 0, $7, $7, $7, $7)"#,
    )
    .bind(id)
    .bind(name)
    .bind(slug)
    .bind(mb_id)
    .bind(country)
    .bind(monitored)
    .bind(now)
    .bind(base_slug)
    .bind(disambiguation.unwrap_or(""))
    .execute(pool)
    .await?;
    Ok(())
}

/// The primary artists already under a base slug.
pub async fn members(pool: &PgPool, base_slug: &str) -> Result<Vec<crate::homonym::Member>, sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, NULLIF("musicbrainzId", '') FROM "Artist"
           WHERE "baseSlug" = $1 AND "primaryArtistId" IS NULL ORDER BY id"#,
    )
    .bind(base_slug)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, mbid)| crate::homonym::Member { id, mbid }).collect())
}
