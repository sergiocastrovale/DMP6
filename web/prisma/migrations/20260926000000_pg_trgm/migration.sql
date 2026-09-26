-- Substring search (ILIKE %q%) over titles and names had no index at all and seq-scanned 1.9M tracks per
-- keystroke. pg_trgm powers the GIN indexes in the migrations that follow. The extension is trusted, and
-- the migrating role is a superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
