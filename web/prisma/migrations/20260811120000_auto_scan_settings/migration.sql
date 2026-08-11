-- Opt-in unattended library scan (index + sync), driven by the monitor plugin on the primary instance.
-- All three columns are nullable: NULL keeps the previous behaviour (env fallback / never scanned), so
-- an existing install is unchanged until the toggle is switched on in Settings → Library.
ALTER TABLE "Settings" ADD COLUMN "autoScanEnabled" BOOLEAN;
ALTER TABLE "Settings" ADD COLUMN "autoScanIntervalHours" INTEGER;
ALTER TABLE "Settings" ADD COLUMN "autoScanLastRunAt" TIMESTAMP(3);
