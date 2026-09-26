-- Stats counts and the /stats/unmatched|incomplete lists filter LocalRelease by matchStatus (5.7k seq scans / 504M tuples read so far).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LocalRelease_matchStatus_idx" ON "LocalRelease"("matchStatus");
