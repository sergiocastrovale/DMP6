-- lowBitrateTracks (/api/stats) and the /stats/bitrate list scan all 1.9M tracks for bitrate 1..255 (~6.6% of rows).
-- A partial index holds only those rows. Prisma cannot declare partial indexes; scripts/test-db allowlists it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalReleaseTrack_lowBitrate_idx" ON "LocalReleaseTrack"("bitrate") WHERE "bitrate" > 0 AND "bitrate" < 256;
