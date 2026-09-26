-- The /issues list filters by status and orders by createdAt; (status, createdAt) serves both.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueEnrichmentGap_status_createdAt_idx" ON "IssueEnrichmentGap"("status", "createdAt");
