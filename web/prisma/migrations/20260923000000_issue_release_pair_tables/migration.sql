-- These two tables were declared in schema.prisma without a migration. Every statement is idempotent
-- so databases that already have them are unaffected, while a fresh install gets them.

CREATE TABLE IF NOT EXISTS "IssueDuplicateRelease" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "releaseAId" TEXT NOT NULL,
    "releaseBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueDuplicateRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IssueMismatchedReleaseId" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "releaseAId" TEXT NOT NULL,
    "releaseBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueMismatchedReleaseId_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IssueDuplicateRelease_status_idx" ON "IssueDuplicateRelease"("status");
CREATE INDEX IF NOT EXISTS "IssueDuplicateRelease_auditRunId_idx" ON "IssueDuplicateRelease"("auditRunId");
CREATE INDEX IF NOT EXISTS "IssueMismatchedReleaseId_status_idx" ON "IssueMismatchedReleaseId"("status");
CREATE INDEX IF NOT EXISTS "IssueMismatchedReleaseId_auditRunId_idx" ON "IssueMismatchedReleaseId"("auditRunId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueDuplicateRelease_auditRunId_fkey') THEN
    ALTER TABLE "IssueDuplicateRelease" ADD CONSTRAINT "IssueDuplicateRelease_auditRunId_fkey"
      FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueDuplicateRelease_releaseAId_fkey') THEN
    ALTER TABLE "IssueDuplicateRelease" ADD CONSTRAINT "IssueDuplicateRelease_releaseAId_fkey"
      FOREIGN KEY ("releaseAId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueDuplicateRelease_releaseBId_fkey') THEN
    ALTER TABLE "IssueDuplicateRelease" ADD CONSTRAINT "IssueDuplicateRelease_releaseBId_fkey"
      FOREIGN KEY ("releaseBId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueMismatchedReleaseId_auditRunId_fkey') THEN
    ALTER TABLE "IssueMismatchedReleaseId" ADD CONSTRAINT "IssueMismatchedReleaseId_auditRunId_fkey"
      FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueMismatchedReleaseId_releaseAId_fkey') THEN
    ALTER TABLE "IssueMismatchedReleaseId" ADD CONSTRAINT "IssueMismatchedReleaseId_releaseAId_fkey"
      FOREIGN KEY ("releaseAId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueMismatchedReleaseId_releaseBId_fkey') THEN
    ALTER TABLE "IssueMismatchedReleaseId" ADD CONSTRAINT "IssueMismatchedReleaseId_releaseBId_fkey"
      FOREIGN KEY ("releaseBId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
