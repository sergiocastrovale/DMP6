-- Least-privilege database role for the web app (audit SEC-09 / PERF-14). Run ONCE, as the owner role (`dmp`, the one in
-- DATABASE_URL), against the dmp database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v web_password='choose-a-long-random-password' -f scripts/sql/create_web_role.sql
--
-- then set WEB_DATABASE_URL (same host and database, user dmp_web, that password) in the NAS .env and redeploy. The web app's
-- Prisma client uses WEB_DATABASE_URL; migrations (`prisma migrate deploy`), the Rust scripts and ./backup keep using
-- DATABASE_URL, so they keep the owner's rights. The web app only ever needs DML, so an injection through it can no longer
-- create or drop objects, read other databases, or COPY ... TO PROGRAM.
--
-- Re-running is safe except for the CREATE ROLE, which errors once the role exists - to change the password later use
-- ALTER ROLE dmp_web PASSWORD '...'. Every statement below ends at a semicolon on its own line, which test/integration/
-- webRole.test.ts relies on to replay this file.

CREATE ROLE dmp_web LOGIN PASSWORD :'web_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;

-- A runaway stats or labs query must not hold a pool connection forever, and a client that dies inside a transaction must
-- not keep its locks. Generous on purpose: the heavy endpoints set a tighter limit of their own (withStatementTimeout),
-- and a bulk merge or delete in a transaction is legitimately slow on a 2M-track library.
ALTER ROLE dmp_web SET statement_timeout = '60s';
ALTER ROLE dmp_web SET idle_in_transaction_session_timeout = '60s';

GRANT USAGE ON SCHEMA public TO dmp_web;
REVOKE CREATE ON SCHEMA public FROM dmp_web;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dmp_web;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dmp_web;

-- Tables and sequences a later migration creates (as the role running this file) get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dmp_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dmp_web;

-- Prisma's own bookkeeping is for the migrate command, not for the web app.
REVOKE ALL ON "_prisma_migrations" FROM dmp_web;
