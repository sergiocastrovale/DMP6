-- Materialized view for timeline decade/year aggregation
-- Replaces real-time groupBy queries that scan all LocalRelease rows

CREATE MATERIALIZED VIEW IF NOT EXISTS dmp_timeline AS
SELECT
  (FLOOR(year / 10) * 10)::int AS decade,
  year,
  COUNT(*)::int AS release_count
FROM "LocalRelease"
WHERE year IS NOT NULL AND year > 0
GROUP BY year;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_dmp_timeline_year ON dmp_timeline (year);
CREATE INDEX IF NOT EXISTS idx_dmp_timeline_decade ON dmp_timeline (decade);

-- Initial refresh
REFRESH MATERIALIZED VIEW dmp_timeline;
