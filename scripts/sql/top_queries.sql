-- Where the database spends its time, from pg_stat_statements (enabled on the NAS Postgres, see docs/deploy.md). Read-only:
--
--   ssh nas "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' ix-postgres-postgres-1 psql -U dmp -d dmp -X" < scripts/sql/top_queries.sql
--
-- Counters accumulate since the last reset (SELECT pg_stat_statements_reset() clears them, a write). Statements slower than
-- 500 ms are also written to the Postgres log (log_min_duration_statement), and the web app logs its own >1 s ones.

SELECT round(total_exec_time / 1000) AS total_s,
       calls,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       round(max_exec_time::numeric) AS max_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT round(mean_exec_time::numeric) AS mean_ms,
       round(max_exec_time::numeric) AS max_ms,
       calls,
       left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND calls >= 5
ORDER BY mean_exec_time DESC
LIMIT 20;
