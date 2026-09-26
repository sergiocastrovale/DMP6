-- Exact and prefix track-title search (lower(title) = 'x' / LIKE 'x%'). A trigram index can only narrow those
-- to "titles containing these trigrams" and then re-checks every candidate in the heap - for a common word
-- that is tens of thousands of row fetches to find no exact match. A btree on lower(title) answers them
-- directly. Prisma cannot declare expression or operator-class indexes; scripts/test-db allowlists it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalReleaseTrack_lower_title_pattern_idx" ON "LocalReleaseTrack" (lower("title") text_pattern_ops);
