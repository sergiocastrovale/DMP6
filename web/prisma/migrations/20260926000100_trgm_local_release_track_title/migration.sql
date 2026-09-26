-- One index per migration file: CONCURRENTLY cannot run inside a transaction, and a migration file with a
-- single statement is not wrapped in one. Builds over ~1.9M titles (expect 1-3 minutes) without blocking
-- writes to LocalReleaseTrack. Prisma cannot declare GIN operator classes; scripts/test-db allowlists it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalReleaseTrack_title_trgm_idx" ON "LocalReleaseTrack" USING gin ("title" gin_trgm_ops);
