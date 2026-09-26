-- DESTRUCTIVE: drops columns and a table that nothing reads or writes. Re-verified against production on 2026-09-26
-- (read-only): Settings.monitorIntervalMin / monitorCap / monitorGapsHours and Statistics.lastSyncArgs are NULL on every
-- row, SearchSource has 0 rows, and no code in web/ or scripts/ references them (the nuke binary's truncate list drops
-- "SearchSource" in the same release - deploy the rebuilt scripts image with this migration). Take ./backup first.
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "monitorIntervalMin";
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "monitorCap";
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "monitorGapsHours";
ALTER TABLE "Statistics" DROP COLUMN IF EXISTS "lastSyncArgs";
DROP TABLE IF EXISTS "SearchSource";
