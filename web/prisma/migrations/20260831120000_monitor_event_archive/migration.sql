-- Lets a monitor issue be dismissed from the flagged list without deleting it, so the Downloads →
-- Events tab can offer Flagged / Archived. Nullable: every existing row stays flagged, which is the
-- behaviour before this migration.
ALTER TABLE "MonitorEvent" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Serves the two list queries (archivedAt IS NULL / IS NOT NULL, ordered by createdAt desc). The
-- existing createdAt index still serves the age-based retention prune.
CREATE INDEX "MonitorEvent_archivedAt_createdAt_idx" ON "MonitorEvent"("archivedAt", "createdAt");
