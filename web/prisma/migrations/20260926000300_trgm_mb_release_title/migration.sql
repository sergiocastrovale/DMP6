CREATE INDEX CONCURRENTLY IF NOT EXISTS "MusicBrainzRelease_title_trgm_idx" ON "MusicBrainzRelease" USING gin ("title" gin_trgm_ops);
