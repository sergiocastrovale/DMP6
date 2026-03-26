-- Enable trigram extension for fast substring search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes for case-insensitive LIKE/ILIKE queries
-- These support Prisma's `contains` + `mode: 'insensitive'` with no code changes
CREATE INDEX IF NOT EXISTS idx_artist_name_trgm ON "Artist" USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_local_release_title_trgm ON "LocalRelease" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_local_release_track_title_trgm ON "LocalReleaseTrack" USING GIN (title gin_trgm_ops);
