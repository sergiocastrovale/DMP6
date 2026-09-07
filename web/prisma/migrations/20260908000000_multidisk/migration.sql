-- docs/multidisk.md §2

-- AlterTable
ALTER TABLE "LocalRelease" ADD COLUMN IF NOT EXISTS "mediumPosition" INTEGER;
ALTER TABLE "LocalRelease" ADD COLUMN IF NOT EXISTS "boxReleaseId" TEXT;
ALTER TABLE "LocalRelease" ADD COLUMN IF NOT EXISTS "boxMediumPosition" INTEGER;

-- AlterTable
ALTER TABLE "MusicBrainzRelease" ADD COLUMN IF NOT EXISTS "releaseGroupSecondaryTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "MusicBrainzReleaseMedium" ADD COLUMN IF NOT EXISTS "equivalentMediumPosition" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LocalRelease_boxReleaseId_idx" ON "LocalRelease"("boxReleaseId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "LocalRelease" ADD CONSTRAINT "LocalRelease_boxReleaseId_fkey" FOREIGN KEY ("boxReleaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
