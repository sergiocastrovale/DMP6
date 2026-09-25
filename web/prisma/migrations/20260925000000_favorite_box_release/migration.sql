-- A dissolved box has no LocalRelease of its own (each disc binds to the standalone album it reprints),
-- so it is favorited through its MusicBrainzRelease. Exactly one of releaseId / boxReleaseId is set -
-- Prisma cannot express that CHECK, so it lives here (same pattern as the Playlist type/userId CHECK in
-- 20260914000000_user_scoped_favorites_playlists).

ALTER TABLE "FavoriteRelease" ALTER COLUMN "releaseId" DROP NOT NULL;
ALTER TABLE "FavoriteRelease" ADD COLUMN "boxReleaseId" TEXT;

ALTER TABLE "FavoriteRelease"
  ADD CONSTRAINT "FavoriteRelease_boxReleaseId_fkey"
  FOREIGN KEY ("boxReleaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FavoriteRelease_userId_boxReleaseId_key" ON "FavoriteRelease"("userId", "boxReleaseId");
CREATE INDEX "FavoriteRelease_boxReleaseId_idx" ON "FavoriteRelease"("boxReleaseId");

ALTER TABLE "FavoriteRelease"
  ADD CONSTRAINT "FavoriteRelease_release_xor_box_check"
  CHECK (("releaseId" IS NULL) <> ("boxReleaseId" IS NULL));
