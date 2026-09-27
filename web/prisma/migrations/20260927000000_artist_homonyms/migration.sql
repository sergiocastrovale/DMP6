-- Two artists, one name (docs/sync_decisions.md "Two artists, one name"). Additive.
--
-- baseSlug: the slug an artist would own if it were alone, i.e. make_slug(name). Rows sharing one form a homonym group;
-- while a group has two or more members every member carries a suffixed slug and the bare slug is the chooser page
-- (scripts/common/src/homonyms.rs). Every row owns its bare slug today, so the backfill is the current slug.
ALTER TABLE "Artist" ADD COLUMN "baseSlug" TEXT;
UPDATE "Artist" SET "baseSlug" = "slug";
CREATE INDEX "Artist_baseSlug_idx" ON "Artist"("baseSlug");

-- A new row that does not say otherwise is alone under its own slug, so its base slug is that slug. Filled here rather
-- than at every insert site (the Rust scripts, the web app's tests and fixtures), so none can forget it. Prisma cannot
-- declare a trigger or a column default taken from another column; the column stays nullable in the schema for that
-- reason, and the trigger is what keeps it filled.
CREATE FUNCTION "artist_default_base_slug"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."baseSlug" IS NULL THEN
    NEW."baseSlug" := NEW."slug";
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "Artist_default_base_slug" BEFORE INSERT ON "Artist" FOR EACH ROW EXECUTE FUNCTION "artist_default_base_slug"();

-- MusicBrainz's own disambiguation comment ("Portuguese band"), shown next to the name when names collide. Display only.
ALTER TABLE "Artist" ADD COLUMN "disambiguation" TEXT;

-- A slug an artist used to have, so old links still land (a group forming or shrinking renames its members).
CREATE TABLE "ArtistSlugHistory" (
    "oldSlug" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistSlugHistory_pkey" PRIMARY KEY ("oldSlug")
);
CREATE INDEX "ArtistSlugHistory_artistId_idx" ON "ArtistSlugHistory"("artistId");
ALTER TABLE "ArtistSlugHistory" ADD CONSTRAINT "ArtistSlugHistory_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A name that more than one MusicBrainz artist answers to exactly: never resolved to one id by the name alone.
ALTER TABLE "MbArtistLookup" ADD COLUMN "ambiguous" BOOLEAN NOT NULL DEFAULT false;
