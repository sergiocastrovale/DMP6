-- Migration: Performance indexes for dmplayer desktop queries at scale
-- Targets: 2M+ tracks, 200K releases, 30K artists

-- -----------------------------------------------------------------------
-- 1. pg_trgm extension (idempotent — already enabled by add_trigram_indexes)
-- -----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------
-- 2. GIN trigram indexes for ILIKE '%query%' substring search
--    (idempotent — these already exist from add_trigram_indexes.sql,
--     repeated here so this migration is self-contained if run alone)
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_artist_name_trgm
  ON "Artist" USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_local_release_title_trgm
  ON "LocalRelease" USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_local_release_track_title_trgm
  ON "LocalReleaseTrack" USING GIN (title gin_trgm_ops);

-- -----------------------------------------------------------------------
-- 3. Expression index on LOWER(genre) for GROUP BY / aggregation queries
--    Prisma @@index cannot express expression indexes.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_local_release_track_genre_lower
  ON "LocalReleaseTrack" (LOWER("genre"));

-- -----------------------------------------------------------------------
-- 4. Composite B-tree: TrackArtist (trackId, role, artistId)
--    Covers WHERE "trackId" = ? AND "role" = 'PRIMARY' with index-only scan.
--    Also declared as @@index in schema.prisma; the raw CREATE is here for
--    clarity and to guarantee column order.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_track_artist_track_role_artist
  ON "TrackArtist" ("trackId", "role", "artistId");

-- -----------------------------------------------------------------------
-- 5. Composite B-tree: LocalReleaseTrack ordering within a release
--    Covers ORDER BY "discNumber", "trackNumber" filtered by localReleaseId.
--    Also declared as @@index in schema.prisma.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_local_release_track_release_disc_track
  ON "LocalReleaseTrack" ("localReleaseId", "discNumber", "trackNumber");

-- -----------------------------------------------------------------------
-- 6. B-tree on LocalRelease.title for ORDER BY title sorting
--    Also declared as @@index in schema.prisma.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_local_release_title_btree
  ON "LocalRelease" ("title");

-- -----------------------------------------------------------------------
-- 7. B-tree on Artist.name for ORDER BY name sorting
--    Also declared as @@index in schema.prisma.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_artist_name_btree
  ON "Artist" ("name");
