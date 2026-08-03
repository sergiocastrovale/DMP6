-- Drop the credit-only artist concept: a TrackRelatedArtist credit now only ever links to an artist
-- that already owns a release via LocalReleaseArtist, so an artist can never be "related only" -
-- the flag would always read false. TrackRelatedArtist itself is untouched; it still holds real
-- artist-to-artist credits.
DROP INDEX IF EXISTS "Artist_relatedOnly_idx";
ALTER TABLE "Artist" DROP COLUMN "relatedOnly";
ALTER TABLE "Statistics" DROP COLUMN "relatedArtists";
