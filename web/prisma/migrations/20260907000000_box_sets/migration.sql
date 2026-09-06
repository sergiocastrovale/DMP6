-- AlterTable
ALTER TABLE "MusicBrainzRelease" ADD COLUMN "mediumCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MusicBrainzReleaseTrack" ADD COLUMN "recordingId" TEXT;

-- CreateTable
CREATE TABLE "MusicBrainzReleaseMedium" (
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
CREATE TABLE "LocalReleaseMember" (
    "id" TEXT NOT NULL,
    "localReleaseId" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "discNumber" INTEGER,

    CONSTRAINT "LocalReleaseMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MusicBrainzReleaseMedium_releaseId_position_key" ON "MusicBrainzReleaseMedium"("releaseId", "position");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseMedium_releaseId_idx" ON "MusicBrainzReleaseMedium"("releaseId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseMedium_equivalentReleaseGroupId_idx" ON "MusicBrainzReleaseMedium"("equivalentReleaseGroupId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseMedium_recordingFingerprint_idx" ON "MusicBrainzReleaseMedium"("recordingFingerprint");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseTrack_recordingId_idx" ON "MusicBrainzReleaseTrack"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalReleaseMember_folderPath_key" ON "LocalReleaseMember"("folderPath");

-- CreateIndex
CREATE INDEX "LocalReleaseMember_localReleaseId_idx" ON "LocalReleaseMember"("localReleaseId");

-- AddForeignKey
ALTER TABLE "MusicBrainzReleaseMedium" ADD CONSTRAINT "MusicBrainzReleaseMedium_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReleaseMember" ADD CONSTRAINT "LocalReleaseMember_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
