-- Idempotent rewrite (docs/multidisk.md §1/§12 step 1): prod applied some of these objects outside
-- migrate deploy during the rejected first attempt, then a ./restore rolled data back to a snapshot
-- that predates recordingId specifically. IF NOT EXISTS / duplicate_object guards let this apply
-- cleanly whether prod has none, some, or all of these objects already.

-- AlterTable
ALTER TABLE "MusicBrainzRelease" ADD COLUMN IF NOT EXISTS "mediumCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MusicBrainzReleaseTrack" ADD COLUMN IF NOT EXISTS "recordingId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MusicBrainzReleaseMedium" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(500),
    "format" TEXT,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "recordingFingerprint" VARCHAR(32),
    "equivalentReleaseGroupId" TEXT,
    "equivalentReleaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicBrainzReleaseMedium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LocalReleaseMember" (
    "id" TEXT NOT NULL,
    "localReleaseId" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "discNumber" INTEGER,

    CONSTRAINT "LocalReleaseMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MusicBrainzReleaseMedium_releaseId_position_key" ON "MusicBrainzReleaseMedium"("releaseId", "position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MusicBrainzReleaseMedium_releaseId_idx" ON "MusicBrainzReleaseMedium"("releaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MusicBrainzReleaseMedium_equivalentReleaseGroupId_idx" ON "MusicBrainzReleaseMedium"("equivalentReleaseGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MusicBrainzReleaseMedium_recordingFingerprint_idx" ON "MusicBrainzReleaseMedium"("recordingFingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MusicBrainzReleaseTrack_recordingId_idx" ON "MusicBrainzReleaseTrack"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LocalReleaseMember_folderPath_key" ON "LocalReleaseMember"("folderPath");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LocalReleaseMember_localReleaseId_idx" ON "LocalReleaseMember"("localReleaseId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MusicBrainzReleaseMedium" ADD CONSTRAINT "MusicBrainzReleaseMedium_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "LocalReleaseMember" ADD CONSTRAINT "LocalReleaseMember_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
