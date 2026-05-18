use chrono::Utc;
use sqlx::PgPool;

pub async fn update_statistics(pool: &PgPool) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"INSERT INTO "Statistics" (
             id, artists, "mainArtists", "relatedArtists",
             tracks, releases, genres,
             "releasesWithCoverArt", playtime, plays,
             "artistsSyncedWithMusicbrainz", "releasesSyncedWithMusicbrainz",
             "artistsWithCoverArt",
             "lastScanEndedAt", "updatedAt"
           )
           SELECT 'main',
             (SELECT COUNT(*)::int FROM "Artist"),
             (SELECT COUNT(*)::int FROM "Artist" WHERE "relatedOnly" = false),
             (SELECT COUNT(*)::int FROM "Artist" WHERE "relatedOnly" = true),
             (SELECT COUNT(*)::int FROM "LocalReleaseTrack"),
             (SELECT COUNT(*)::int FROM "LocalRelease"),
             (SELECT COUNT(*)::int FROM "Genre"),
             (SELECT COUNT(*)::int FROM "LocalRelease" WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             COALESCE((SELECT SUM(duration)::bigint FROM "LocalReleaseTrack"), 0),
             COALESCE((SELECT SUM("playCount")::bigint FROM "LocalReleaseTrack"), 0),
             (SELECT COUNT(*)::int FROM "Artist" WHERE "musicbrainzId" IS NOT NULL),
             (SELECT COUNT(*)::int FROM "MusicBrainzRelease"),
             (SELECT COUNT(*)::int FROM "Artist" WHERE image IS NOT NULL OR "imageUrl" IS NOT NULL),
             $1, $1
           ON CONFLICT (id) DO UPDATE SET
             artists = EXCLUDED.artists,
             "mainArtists" = EXCLUDED."mainArtists",
             "relatedArtists" = EXCLUDED."relatedArtists",
             tracks = EXCLUDED.tracks,
             releases = EXCLUDED.releases,
             genres = EXCLUDED.genres,
             "releasesWithCoverArt" = EXCLUDED."releasesWithCoverArt",
             playtime = EXCLUDED.playtime,
             plays = EXCLUDED.plays,
             "artistsSyncedWithMusicbrainz" = EXCLUDED."artistsSyncedWithMusicbrainz",
             "releasesSyncedWithMusicbrainz" = EXCLUDED."releasesSyncedWithMusicbrainz",
             "artistsWithCoverArt" = EXCLUDED."artistsWithCoverArt",
             "lastScanEndedAt" = EXCLUDED."lastScanEndedAt",
             "updatedAt" = EXCLUDED."updatedAt""#,
    )
    .bind(now)
    .execute(pool)
    .await?;

    Ok(())
}
