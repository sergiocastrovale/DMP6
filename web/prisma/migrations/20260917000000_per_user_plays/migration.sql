-- Plays become per-user and private (see CLAUDE.md Data Model), same pattern as FavoriteTrack.
-- LocalReleaseTrack.playCount/lastPlayedAt, LocalRelease.totalPlayCount/lastPlayedAt,
-- Artist.totalPlayCount and Statistics.plays were shared across every user with no way to tell
-- who played what. Existing counts have no owner to attribute them to, so they are dropped
-- (confirmed with user 2026-09-16), same as the favorites/playlists precedent.

-- 1. New per-user counter table, one row per (user, track).
CREATE TABLE "LocalReleaseTrackPlay" (
    "id"           TEXT NOT NULL,
    "userId"       INTEGER NOT NULL,
    "trackId"      TEXT NOT NULL,
    "playCount"    INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalReleaseTrackPlay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocalReleaseTrackPlay_userId_trackId_key" ON "LocalReleaseTrackPlay"("userId", "trackId");
CREATE INDEX "LocalReleaseTrackPlay_trackId_idx" ON "LocalReleaseTrackPlay"("trackId");
CREATE INDEX "LocalReleaseTrackPlay_userId_lastPlayedAt_idx" ON "LocalReleaseTrackPlay"("userId", "lastPlayedAt");
CREATE INDEX "LocalReleaseTrackPlay_userId_playCount_idx" ON "LocalReleaseTrackPlay"("userId", "playCount");

ALTER TABLE "LocalReleaseTrackPlay" ADD CONSTRAINT "LocalReleaseTrackPlay_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalReleaseTrackPlay" ADD CONSTRAINT "LocalReleaseTrackPlay_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Drop the old shared columns/indexes.
DROP INDEX "LocalReleaseTrack_lastPlayedAt_idx";
DROP INDEX "LocalReleaseTrack_playCount_idx";
ALTER TABLE "LocalReleaseTrack" DROP COLUMN "playCount";
ALTER TABLE "LocalReleaseTrack" DROP COLUMN "lastPlayedAt";

DROP INDEX "LocalRelease_lastPlayedAt_idx";
ALTER TABLE "LocalRelease" DROP COLUMN "totalPlayCount";
ALTER TABLE "LocalRelease" DROP COLUMN "lastPlayedAt";

DROP INDEX "Artist_totalPlayCount_idx";
ALTER TABLE "Artist" DROP COLUMN "totalPlayCount";

ALTER TABLE "Statistics" DROP COLUMN "plays";
