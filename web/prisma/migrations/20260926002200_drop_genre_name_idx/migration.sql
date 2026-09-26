-- Dropped by PERF-02 (docs/audit_2026-09-26.md). Verified against prod pg_stat_user_indexes: ~0 scans since statistics started, and no query in web/ or scripts/ filters on this column (it is only selected/upserted). Every write to the table pays for the index.
-- Duplicate of the unique index Genre_name_key.
DROP INDEX CONCURRENTLY IF EXISTS "Genre_name_idx";
