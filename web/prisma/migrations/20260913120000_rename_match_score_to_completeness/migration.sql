-- `averageMatchScore` is catalogue completeness (owned album/EP releases / total album/EP
-- catalogue) - renamed to say so. Column + index rename only: metadata-only, no table rewrite,
-- no data loss.
ALTER TABLE "Artist" RENAME COLUMN "averageMatchScore" TO "completeness";
ALTER INDEX "Artist_averageMatchScore_idx" RENAME TO "Artist_completeness_idx";
