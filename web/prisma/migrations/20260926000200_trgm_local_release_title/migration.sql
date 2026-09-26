CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalRelease_title_trgm_idx" ON "LocalRelease" USING gin ("title" gin_trgm_ops);
