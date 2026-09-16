use sqlx::PgPool;

/// An existing Artist row that blocks `./add` from creating a new one, resolved to whichever slug the
/// caller should be told about - the primary artist's, if the match is a connected duplicate.
pub struct ExistingArtist {
    pub name: String,
    pub slug: String,
}

/// Looks for an existing Artist by MusicBrainz id (any row, including a connected duplicate that
/// isn't itself the primary - resolved up to its `primaryArtistId`) or by the slug the new artist
/// would take. Folder-exists is checked separately by the caller (filesystem, not DB).
pub async fn find_existing_artist(
    pool: &PgPool,
    mb_id: &str,
    slug: &str,
) -> Result<Option<ExistingArtist>, sqlx::Error> {
    let row: Option<(String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(p.name, a.name), COALESCE(p.slug, a.slug)
           FROM "Artist" a
           LEFT JOIN "Artist" p ON p.id = a."primaryArtistId"
           WHERE a."musicbrainzId" = $1 OR a.slug = $2
           LIMIT 1"#,
    )
    .bind(mb_id)
    .bind(slug)
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
    mb_id: &str,
    country: Option<&str>,
    monitored: bool,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "Artist"
             (id, name, slug, "musicbrainzId", country, "manuallyAdded", monitored,
              "totalTracks", "totalFileSize", "lastSyncedAt", "lastGapsCheckedAt",
              "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, true, $6, 0, 0, $7, $7, $7, $7)"#,
    )
    .bind(id)
    .bind(name)
    .bind(slug)
    .bind(mb_id)
    .bind(country)
    .bind(monitored)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}
