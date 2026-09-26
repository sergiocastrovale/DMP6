-- /api/releases/updated lists the most recently changed releases (ORDER BY updatedAt DESC LIMIT n).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalRelease_updatedAt_idx" ON "LocalRelease"("updatedAt");
