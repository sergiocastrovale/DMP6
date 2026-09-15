-- ArtistFacts: "Did you know..." trivia cache (Genius API), see CLAUDE.md Data Model.
CREATE TABLE "ArtistFacts" (
    "id"        TEXT NOT NULL,
    "artistId"  TEXT NOT NULL,
    "releaseId" TEXT,
    "trackId"   TEXT,
    "text"      TEXT NOT NULL,
    "hash"      VARCHAR(40) NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistFacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtistFacts_artistId_hash_key" ON "ArtistFacts"("artistId", "hash");
CREATE INDEX "ArtistFacts_artistId_idx" ON "ArtistFacts"("artistId");

ALTER TABLE "ArtistFacts" ADD CONSTRAINT "ArtistFacts_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistFacts" ADD CONSTRAINT "ArtistFacts_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistFacts" ADD CONSTRAINT "ArtistFacts_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Genius API credentials (override GENIUS_CLIENT_ID / GENIUS_SECRET / GENIUS_ACCESS_TOKEN)
ALTER TABLE "Settings" ADD COLUMN "geniusClientId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "geniusSecret" TEXT;
ALTER TABLE "Settings" ADD COLUMN "geniusAccessToken" TEXT;
