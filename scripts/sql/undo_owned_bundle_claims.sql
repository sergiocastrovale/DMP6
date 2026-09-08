-- One-off repair for the "owned bundle claim" era (scripts/sync/src/owned.rs, pre-containment-note).
--
-- The old claim marked a release COMPLETE whenever every one of its tracks was found inside a bigger
-- local release. That is not ownership: a box set's or compilation's rendition of an album is a
-- different edition, usually a different master. The claim told collectors they held ~1.5k releases
-- they do not, and took every one of them out of the MISSING acquisition pool.
--
-- Statement 1 turns those claims back into gaps, keeping the note (now in the new wording) so the
-- catalogue can still say where the recordings can already be heard.
--
-- Statement 2 undoes the claim's second effect: it repointed the *container's* own local tracks at the
-- claimed release's MB tracks, unconditionally (link_local_tracks_to_mb). Those tracks lose their real
-- MB identity, and `sync --only-write-mb-to-files` writes the mismatched album/track id pair into the
-- files. Nulling them is safe - the ordinary sync path re-links each release's tracks from its own
-- matched tracklist on the next run.
--
-- Read-only preview of both sets first:
--   SELECT count(*) FROM "MusicBrainzRelease" WHERE "statusReason" LIKE 'Owned as part of%';
--   SELECT count(*) FROM "LocalReleaseTrack" t
--     JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
--     JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
--    WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId";

BEGIN;

UPDATE "MusicBrainzRelease"
   SET status = 'MISSING',
       "statusReason" = 'Recordings inside ' || substring("statusReason" FROM 'Owned as part of (.*)'),
       "updatedAt" = NOW()
 WHERE "statusReason" LIKE 'Owned as part of "%"';

UPDATE "LocalReleaseTrack" t
   SET "mbTrackId" = NULL,
       "updatedAt" = NOW()
  FROM "MusicBrainzReleaseTrack" mt, "LocalRelease" lr, "MusicBrainzRelease" owner
 WHERE mt.id = t."mbTrackId"
   AND lr.id = t."localReleaseId"
   AND owner.id = mt."releaseId"
   AND lr."releaseId" IS NOT NULL
   AND mt."releaseId" <> lr."releaseId"
   -- Scoped to the claim's own rows (renamed by statement 1 above), so a cross-release link any other
   -- pass legitimately made is left alone.
   AND owner."statusReason" LIKE 'Recordings inside "%"';

COMMIT;
