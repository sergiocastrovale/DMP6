-- One-off cleanup for the box_editions self-equivalence bug (tiers 2/3 previously matched a
-- single-medium release's own medium against its own release's tracklist, an unguarded equality).
-- Run the preview first, take a backup, then run the UPDATE, then re-run the preview to confirm 0 rows.
-- Safe to re-run: idempotent, touches nothing box_editions' own tiers wouldn't re-derive correctly on
-- the next sync now that the fix is deployed.

-- Preview: rows where a medium points at its own parent release.
SELECT count(*) AS self_equivalent_media
FROM "MusicBrainzReleaseMedium" m
WHERE m."equivalentReleaseId" = m."releaseId";

-- Apply:
-- UPDATE "MusicBrainzReleaseMedium" m
-- SET "equivalentReleaseId" = NULL, "equivalentReleaseGroupId" = NULL,
--     "equivalentMediumPosition" = NULL, "recordingFingerprint" = NULL, "updatedAt" = now()
-- WHERE m."equivalentReleaseId" = m."releaseId";

-- Applied: 59,035 rows cleared, re-run of the preview confirmed 0 remaining.
