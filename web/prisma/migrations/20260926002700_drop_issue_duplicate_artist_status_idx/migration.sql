-- Superseded by IssueDuplicateArtist_status_createdAt_idx (status is its leading column), created by an earlier migration in this series.
DROP INDEX CONCURRENTLY IF EXISTS "IssueDuplicateArtist_status_idx";
