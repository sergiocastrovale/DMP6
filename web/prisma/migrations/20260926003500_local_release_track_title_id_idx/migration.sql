-- The /statistics/tracks list ordered by title sorted all 1.9M tracks (a parallel seq scan of the 9 GB table) for every
-- uncached page. (title, id) serves `ORDER BY title, id` straight from the index, and INCLUDE (artist) lets the page
-- come from the index alone. Prisma cannot declare INCLUDE columns; scripts/test-db allowlists it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalReleaseTrack_title_id_idx" ON "LocalReleaseTrack"("title", "id") INCLUDE ("artist");
