-- Prefix lookups such as "filePath" LIKE 'Artist/%' cannot use a default btree index under a non-C
-- database collation, so every per-folder lookup was a sequential scan. Prisma cannot express btree
-- operator classes, so these indexes exist only here; scripts/test-db's drift check allowlists them.
CREATE INDEX IF NOT EXISTS "LocalReleaseTrack_filePath_pattern_idx"
  ON "LocalReleaseTrack" ("filePath" varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS "LocalRelease_folderPath_pattern_idx"
  ON "LocalRelease" ("folderPath" text_pattern_ops);
