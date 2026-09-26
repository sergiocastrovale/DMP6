CREATE INDEX CONCURRENTLY IF NOT EXISTS "Artist_name_trgm_idx" ON "Artist" USING gin ("name" gin_trgm_ops);
