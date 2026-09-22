-- One-off repair for the no-guessing release-placement rollout (scripts/common/src/consensus.rs,
-- docs/no_guessing.md).
--
-- Before this change, a folder-release's title came from the *mode* of its tracks' album tags
-- (index's old `folder_majority_title_year`), and sync bound a folder whose embedded MusicBrainz ids
-- merely had a plurality winner (`tags_agree_on`'s ">50% of tagged tracks", `get_majority_id`'s mode).
-- Both guessed: a folder naming five different albums got titled after whichever string happened to
-- appear most, and a scattered compilation's plurality id could still bind and even score COMPLETE.
-- The new rule is unanimity only - anything less becomes UNKNOWN with a human-readable statusReason
-- instead of a guessed placement (fake "N editions" artist-page stacks, e.g. Al Jolson's "The World's
-- Greatest Entertainer" x5 built from unrelated budget compilations).
--
-- This migrates every release already in the DB against that new rule in one pass, rather than
-- waiting for the next full re-index/re-sync of the whole library to reach it release by release.
--
-- Read-only preview first - run this, record the numbers, before touching anything:
--
--   WITH t AS (
--     SELECT lr.id AS lrid,
--            lower(regexp_replace(btrim(normalize(tr.album, NFC)), '\s+', ' ', 'g')) AS alb,
--            nullif(lower(substring(tr."mbReleaseId"      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rel,
--            nullif(lower(substring(tr."mbReleaseGroupId" from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rg,
--            tr.year AS yr
--       FROM "LocalRelease" lr
--       JOIN "LocalReleaseTrack" tr ON tr."localReleaseId" = lr.id
--      WHERE lr."boxReleaseId"   IS NULL
--        AND lr."mediumPosition" IS NULL
--        AND lr."forcedComplete" = false
--        AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
--   ), agg AS (
--     SELECT lrid,
--            count(*)                                              AS n,
--            count(*) FILTER (WHERE alb IS NOT NULL AND alb <> '')  AS n_alb,
--            count(DISTINCT alb) FILTER (WHERE alb IS NOT NULL AND alb <> '') AS d_alb,
--            count(DISTINCT rel) FILTER (WHERE rel IS NOT NULL)     AS d_rel,
--            count(DISTINCT rg)  FILTER (WHERE rg  IS NOT NULL)     AS d_rg,
--            count(DISTINCT yr)  FILTER (WHERE yr  IS NOT NULL)     AS d_yr,
--            min(yr)                                                AS one_yr
--       FROM t GROUP BY lrid
--   ), verdict AS (
--     SELECT lrid,
--            CASE
--              WHEN n_alb = 0            THEN 'No track in the release folder has an ''album'' metadata field'
--              WHEN d_alb > 1            THEN 'Tracks in the release folder disagree in ''album'' metadata field'
--              WHEN n_alb < n            THEN 'Some tracks in the release folder have no ''album'' metadata field'
--              WHEN d_rel > 1 AND d_rg = 1 THEN 'Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID'
--              WHEN d_rel > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz album id'
--              WHEN d_rg  > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz release group id'
--            END AS reason,
--            CASE WHEN d_yr = 1 THEN one_yr END AS yr
--       FROM agg
--   )
--   SELECT v.reason, lr."matchStatus", count(*)
--     FROM verdict v JOIN "LocalRelease" lr ON lr.id = v.lrid
--    WHERE v.reason IS NOT NULL
--    GROUP BY 1,2 ORDER BY 1,2;
--   -- expect ~16,822 total: album disagree 14,688 / missing 19 / MB-id 2,115
--   -- (the 2,115 now splits three ways across reasons 4/5/6 - record the actual split)
--   SELECT count(*) FROM verdict v JOIN "LocalRelease" lr ON lr.id = v.lrid
--    WHERE v.reason IS NOT NULL AND lr."matchStatus" = 'COMPLETE';   -- expect 5,039
--
-- Undo dumps (run on the NAS BEFORE Tx 1, by hand - no in-repo precedent for this shape):
--
--   sudo docker exec dmp psql "$DATABASE_URL" -c "\copy (
--     SELECT lr.id, lr.title, lr.year, lr.\"releaseId\", lr.\"matchStatus\"
--       FROM \"LocalRelease\" lr
--       JOIN ( <the verdict CTE above> ) v ON v.lrid = lr.id
--      WHERE v.reason IS NOT NULL
--   ) TO STDOUT" > logs/undo20_album_consensus_releases.tsv
--
--   sudo docker exec dmp psql "$DATABASE_URL" -c "\copy (
--     SELECT t.id, t.\"mbTrackId\"
--       FROM \"LocalReleaseTrack\" t
--       JOIN ( <the verdict CTE above> ) v ON v.lrid = t.\"localReleaseId\"
--      WHERE v.reason IS NOT NULL AND t.\"mbTrackId\" IS NOT NULL
--   ) TO STDOUT" > logs/undo20_album_consensus_links.tsv
--
-- Tx 1 below flags every non-agreeing release UNKNOWN with its reason, clears its releaseId and its
-- tracks' mbTrackId links, and retitles it to the folder leaf name (no metadata left to display).
-- Clean rows are untouched except for `year`, set only when the tracks unanimously agree on one -
-- index/sync own titles for those, this pass has no better information than they do.
--
-- Tx 2 sweeps MusicBrainzRelease rows the newly-unbound releases leave orphaned, mirroring
-- `dmp_sync::db::delete_orphaned_mb_releases`'s global branch verbatim (every guard kept) - without
-- this they linger as phantom gap cards, and `tidy --rescore-only` does not run this sweep
-- (docs/sync_decisions.md §19 "Gaps in sync and tidy").

BEGIN;

WITH t AS (
  SELECT lr.id AS lrid,
         lower(regexp_replace(btrim(normalize(tr.album, NFC)), '\s+', ' ', 'g')) AS alb,
         nullif(lower(substring(tr."mbReleaseId"      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rel,
         nullif(lower(substring(tr."mbReleaseGroupId" from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rg,
         tr.year AS yr
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" tr ON tr."localReleaseId" = lr.id
   WHERE lr."boxReleaseId"   IS NULL
     AND lr."mediumPosition" IS NULL
     AND lr."forcedComplete" = false
     AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
), agg AS (
  SELECT lrid,
         count(*)                                              AS n,
         count(*) FILTER (WHERE alb IS NOT NULL AND alb <> '')  AS n_alb,
         count(DISTINCT alb) FILTER (WHERE alb IS NOT NULL AND alb <> '') AS d_alb,
         count(DISTINCT rel) FILTER (WHERE rel IS NOT NULL)     AS d_rel,
         count(DISTINCT rg)  FILTER (WHERE rg  IS NOT NULL)     AS d_rg,
         count(DISTINCT yr)  FILTER (WHERE yr  IS NOT NULL)     AS d_yr,
         min(yr)                                                AS one_yr
    FROM t GROUP BY lrid
), verdict AS (
  SELECT lrid,
         CASE
           WHEN n_alb = 0            THEN 'No track in the release folder has an ''album'' metadata field'
           WHEN d_alb > 1            THEN 'Tracks in the release folder disagree in ''album'' metadata field'
           WHEN n_alb < n            THEN 'Some tracks in the release folder have no ''album'' metadata field'
           WHEN d_rel > 1 AND d_rg = 1 THEN 'Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID'
           WHEN d_rel > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz album id'
           WHEN d_rg  > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz release group id'
         END AS reason,
         CASE WHEN d_yr = 1 THEN one_yr END AS yr
    FROM agg
)
-- Flagged rows: unbind, park UNKNOWN with the reason, retitle to the folder leaf, clear the year
-- unless the tracks unanimously agree on one.
UPDATE "LocalRelease" lr
   SET "releaseId"    = NULL,
       "matchStatus"  = 'UNKNOWN'::"ReleaseStatus",
       "statusReason" = v.reason,
       title          = left(regexp_replace(COALESCE(lr."folderPath", lr.title), '^.*/', ''), 500),
       year           = v.yr,
       "updatedAt"    = NOW()
  FROM verdict v
 WHERE v.lrid = lr.id
   AND v.reason IS NOT NULL;

-- Their tracks: clear the MB recording link a now-unbound release's tracks were claiming.
WITH t AS (
  SELECT lr.id AS lrid,
         lower(regexp_replace(btrim(normalize(tr.album, NFC)), '\s+', ' ', 'g')) AS alb,
         nullif(lower(substring(tr."mbReleaseId"      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rel,
         nullif(lower(substring(tr."mbReleaseGroupId" from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rg,
         tr.year AS yr
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" tr ON tr."localReleaseId" = lr.id
   WHERE lr."boxReleaseId"   IS NULL
     AND lr."mediumPosition" IS NULL
     AND lr."forcedComplete" = false
     AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
), agg AS (
  SELECT lrid,
         count(*)                                              AS n,
         count(*) FILTER (WHERE alb IS NOT NULL AND alb <> '')  AS n_alb,
         count(DISTINCT alb) FILTER (WHERE alb IS NOT NULL AND alb <> '') AS d_alb,
         count(DISTINCT rel) FILTER (WHERE rel IS NOT NULL)     AS d_rel,
         count(DISTINCT rg)  FILTER (WHERE rg  IS NOT NULL)     AS d_rg
    FROM t GROUP BY lrid
), verdict AS (
  SELECT lrid,
         CASE
           WHEN n_alb = 0            THEN 'No track in the release folder has an ''album'' metadata field'
           WHEN d_alb > 1            THEN 'Tracks in the release folder disagree in ''album'' metadata field'
           WHEN n_alb < n            THEN 'Some tracks in the release folder have no ''album'' metadata field'
           WHEN d_rel > 1 AND d_rg = 1 THEN 'Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID'
           WHEN d_rel > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz album id'
           WHEN d_rg  > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz release group id'
         END AS reason
    FROM agg
)
UPDATE "LocalReleaseTrack" trk
   SET "mbTrackId" = NULL,
       "updatedAt" = NOW()
  FROM verdict v
 WHERE v.lrid = trk."localReleaseId"
   AND v.reason IS NOT NULL
   AND trk."mbTrackId" IS NOT NULL;

-- Clean rows (verdict.reason IS NULL): nothing to unbind, but set year when the tracks unanimously
-- agree on one - index/sync own titles for these, so title is left alone.
WITH t AS (
  SELECT lr.id AS lrid,
         lower(regexp_replace(btrim(normalize(tr.album, NFC)), '\s+', ' ', 'g')) AS alb,
         nullif(lower(substring(tr."mbReleaseId"      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rel,
         nullif(lower(substring(tr."mbReleaseGroupId" from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rg,
         tr.year AS yr
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" tr ON tr."localReleaseId" = lr.id
   WHERE lr."boxReleaseId"   IS NULL
     AND lr."mediumPosition" IS NULL
     AND lr."forcedComplete" = false
     AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
), agg AS (
  SELECT lrid,
         count(*)                                              AS n,
         count(*) FILTER (WHERE alb IS NOT NULL AND alb <> '')  AS n_alb,
         count(DISTINCT alb) FILTER (WHERE alb IS NOT NULL AND alb <> '') AS d_alb,
         count(DISTINCT rel) FILTER (WHERE rel IS NOT NULL)     AS d_rel,
         count(DISTINCT rg)  FILTER (WHERE rg  IS NOT NULL)     AS d_rg,
         count(DISTINCT yr)  FILTER (WHERE yr  IS NOT NULL)     AS d_yr,
         min(yr)                                                AS one_yr
    FROM t GROUP BY lrid
), verdict AS (
  SELECT lrid,
         CASE
           WHEN n_alb = 0            THEN 'No track in the release folder has an ''album'' metadata field'
           WHEN d_alb > 1            THEN 'Tracks in the release folder disagree in ''album'' metadata field'
           WHEN n_alb < n            THEN 'Some tracks in the release folder have no ''album'' metadata field'
           WHEN d_rel > 1 AND d_rg = 1 THEN 'Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID'
           WHEN d_rel > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz album id'
           WHEN d_rg  > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz release group id'
         END AS reason,
         CASE WHEN d_yr = 1 THEN one_yr END AS yr
    FROM agg
)
UPDATE "LocalRelease" lr
   SET year        = v.yr,
       "updatedAt" = NOW()
  FROM verdict v
 WHERE v.lrid = lr.id
   AND v.reason IS NULL
   AND lr.year IS DISTINCT FROM v.yr;

-- Tx 2 - orphan MB-release sweep: mirrors dmp_sync::db::delete_orphaned_mb_releases's global branch
-- verbatim. Every guard kept: not MISSING, no LocalRelease.releaseId, no LocalRelease.boxReleaseId, no
-- LocalReleaseTrack -> MusicBrainzReleaseTrack still pointing at it.
DELETE FROM "MusicBrainzRelease" m
 WHERE m.status <> 'MISSING'
   AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id)
   AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."boxReleaseId" = m.id)
   AND NOT EXISTS (
         SELECT 1 FROM "LocalReleaseTrack" lt
         JOIN "MusicBrainzReleaseTrack" mt ON mt.id = lt."mbTrackId"
         WHERE mt."releaseId" = m.id
       );

COMMIT;

-- Restore SQL (commented - reverses Tx 1's LocalRelease/LocalReleaseTrack writes only; Tx 2's deletes
-- are not reversible from here, restore MusicBrainzRelease rows from a DB backup if ever needed):
--
--   BEGIN;
--   CREATE TEMP TABLE undo20_releases (id text, title text, year int, "releaseId" text, "matchStatus" text) ON COMMIT DROP;
--   \copy undo20_releases FROM 'logs/undo20_album_consensus_releases.tsv'
--   CREATE TEMP TABLE undo20_links (id text, "mbTrackId" text) ON COMMIT DROP;
--   \copy undo20_links FROM 'logs/undo20_album_consensus_links.tsv'
--
--   UPDATE "LocalRelease" lr
--      SET title = u.title, year = u.year, "releaseId" = u."releaseId",
--          "matchStatus" = u."matchStatus"::"ReleaseStatus", "statusReason" = NULL, "updatedAt" = NOW()
--     FROM undo20_releases u
--    WHERE u.id = lr.id;
--
--   UPDATE "LocalReleaseTrack" t
--      SET "mbTrackId" = u."mbTrackId", "updatedAt" = NOW()
--     FROM undo20_links u
--    WHERE u.id = t.id;
--   COMMIT;
