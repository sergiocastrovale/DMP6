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

UPDATE "MusicBrainzRelease" m
   SET status = 'MISSING',
       "statusReason" = 'Recordings inside ' || substring(m."statusReason" FROM 'Owned as part of (.*)'),
       "updatedAt" = NOW()
 WHERE m."statusReason" LIKE 'Owned as part of "%"'
   -- Box provenance guard (mandatory per docs/containment.md §2.2): a claim row that multidisk has
   -- since bound as a box (LocalRelease.boxReleaseId points at it) must not be flipped back to MISSING
   -- - that would undo days of dissolve work. 0 rows matched this at the time this ran, but the guard
   -- stays so a re-run after further multidisk activity stays safe.
   AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr2 WHERE lr2."boxReleaseId" = m.id);

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
   AND owner."statusReason" LIKE 'Recordings inside "%"'
   -- Same box-provenance guard as statement 1 - never null a link a dissolved box still depends on.
   AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr2 WHERE lr2."boxReleaseId" = owner.id);

COMMIT;
