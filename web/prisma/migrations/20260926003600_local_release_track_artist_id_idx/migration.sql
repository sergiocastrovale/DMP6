-- The /statistics/tracks list ordered by artist sorted all 1.9M tracks for every uncached page, like the title order
-- before LocalReleaseTrack_title_id_idx. (artist, id) serves `ORDER BY artist, id` straight from the index and
-- INCLUDE (title) lets the page come from the index alone. Prisma cannot declare INCLUDE columns; scripts/test-db
-- allowlists it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalReleaseTrack_artist_id_idx" ON "LocalReleaseTrack"("artist", "id") INCLUDE ("title");
