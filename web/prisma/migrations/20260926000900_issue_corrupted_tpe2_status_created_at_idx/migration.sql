-- The /issues list filters by status and orders by createdAt; (status, createdAt) serves both.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueCorruptedTpe2_status_createdAt_idx" ON "IssueCorruptedTpe2"("status", "createdAt");
