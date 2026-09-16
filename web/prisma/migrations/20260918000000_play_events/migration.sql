-- Per-listen event log, feeds LocalReleaseTrackPlay's counter. See CLAUDE.md Data Model.

CREATE TYPE "PlaySource" AS ENUM ('QUEUE', 'PLAYLIST', 'CATALOGUE', 'EXPLORER', 'RANDOM');

CREATE TABLE "PlayEvent" (
    "id"              TEXT NOT NULL,
    "userId"          INTEGER NOT NULL,
    "trackId"         TEXT NOT NULL,
    "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"         TIMESTAMP(3),
    "listenedSeconds" INTEGER NOT NULL DEFAULT 0,
    "trackDuration"   INTEGER,
    "counted"         BOOLEAN NOT NULL DEFAULT false,
    "skipped"         BOOLEAN NOT NULL DEFAULT false,
    "source"          "PlaySource" NOT NULL,

    CONSTRAINT "PlayEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayEvent_userId_startedAt_idx" ON "PlayEvent"("userId", "startedAt");
CREATE INDEX "PlayEvent_userId_trackId_startedAt_idx" ON "PlayEvent"("userId", "trackId", "startedAt");
CREATE INDEX "PlayEvent_trackId_idx" ON "PlayEvent"("trackId");

ALTER TABLE "PlayEvent" ADD CONSTRAINT "PlayEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayEvent" ADD CONSTRAINT "PlayEvent_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
