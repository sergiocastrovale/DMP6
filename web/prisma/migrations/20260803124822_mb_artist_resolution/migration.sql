-- MusicBrainz-validated artist resolution.
--
-- Artist identity stops being guessed from punctuation and is confirmed against MusicBrainz instead.
-- Three parts:
--   1. multi-value tag frames, kept in file order, so Picard's own artist split can be reused verbatim
--   2. a persistent lookup cache (hits AND misses) so the 1.1 req/s MB budget is paid once per name
--   3. the unsplit-artist audit detector is retired - the resolver now decides splits at index time

-- 1. Multi-value tag frames. artists[i] pairs with mbArtistIds[i] when the lengths match.
ALTER TABLE "LocalReleaseTrack" ADD COLUMN "artists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LocalReleaseTrack" ADD COLUMN "mbArtistIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LocalReleaseTrack" ADD COLUMN "albumArtists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LocalReleaseTrack" ADD COLUMN "mbAlbumArtistIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. Resolution cache. mbid IS NULL means "MusicBrainz confirmed it does not know this name" - a
-- cached miss, re-checked after a TTL rather than re-queried every run.
CREATE TABLE "MbArtistLookup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "mbid" TEXT,
    "mbName" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MbArtistLookup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MbArtistLookup_name_key" ON "MbArtistLookup"("name");
CREATE INDEX "MbArtistLookup_normalized_idx" ON "MbArtistLookup"("normalized");
CREATE INDEX "MbArtistLookup_checkedAt_idx" ON "MbArtistLookup"("checkedAt");

-- 3. Credit artists own no release, so they are counted separately from browsable ones. Ownership
-- itself stays derived from LocalReleaseArtist - deliberately no flag on Artist.
ALTER TABLE "Statistics" ADD COLUMN "creditArtists" INTEGER NOT NULL DEFAULT 0;

-- 4. Retire the unsplit-artist detector: compound names are now resolved against MusicBrainz during
-- index, so there is nothing left for a human to review here.
DROP TABLE "IssueUnsplitArtist";
