-- Migration: Add triggers for S3 image cleanup on delete
-- This ensures S3 images are queued for deletion when artists or releases are deleted

-- Create a table to track images that need to be deleted from S3
CREATE TABLE IF NOT EXISTS "S3DeletionQueue" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "objectKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Function to queue artist image for S3 deletion
CREATE OR REPLACE FUNCTION queue_artist_image_deletion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if imageUrl is set (indicates S3 storage was used)
  IF OLD."imageUrl" IS NOT NULL AND OLD."imageUrl" != '' THEN
    -- Extract the S3 key from the URL (everything after the last /)
    INSERT INTO "S3DeletionQueue" ("objectKey")
    VALUES ('artists/' || OLD.slug || '.jpg')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to queue release image for S3 deletion
CREATE OR REPLACE FUNCTION queue_release_image_deletion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if imageUrl is set (indicates S3 storage was used)
  IF OLD."imageUrl" IS NOT NULL AND OLD."imageUrl" != '' THEN
    -- Extract the release ID from the image field
    INSERT INTO "S3DeletionQueue" ("objectKey")
    VALUES ('releases/' || OLD.id || '.jpg')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS artist_image_deletion_trigger ON "Artist";
CREATE TRIGGER artist_image_deletion_trigger
  BEFORE DELETE ON "Artist"
  FOR EACH ROW
  EXECUTE FUNCTION queue_artist_image_deletion();

DROP TRIGGER IF EXISTS release_image_deletion_trigger ON "LocalRelease";
CREATE TRIGGER release_image_deletion_trigger
  BEFORE DELETE ON "LocalRelease"
  FOR EACH ROW
  EXECUTE FUNCTION queue_release_image_deletion();

-- Note: A background worker or cleanup script should process this queue
-- and actually delete the files from S3 and local storage
