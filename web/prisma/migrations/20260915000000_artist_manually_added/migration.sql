-- Artists added via ./add (POST /api/artists/*) before owning any files. Shows in /browse and is
-- exempt from the orphan-artist sweep, both gated by this column - see CLAUDE.md Data Model.
ALTER TABLE "Artist" ADD COLUMN "manuallyAdded" BOOLEAN NOT NULL DEFAULT false;
