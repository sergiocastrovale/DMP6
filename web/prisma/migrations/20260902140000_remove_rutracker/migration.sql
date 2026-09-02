-- Remove the RuTracker download source. Downloads are now Soulseek-only.

-- 1. Carry the current Soulseek on/off state over before the DownloadSources table goes.
ALTER TABLE "Settings" ADD COLUMN "downloadsEnabled" BOOLEAN;
UPDATE "Settings" s SET "downloadsEnabled" = ds.enabled
  FROM "DownloadSources" ds WHERE ds.name = 'SLSKD';

-- 2. In-flight RuTracker acquisitions can never finish now: park them so the
--    trickle worker re-searches them on Soulseek. Terminal rows keep their history.
UPDATE "DownloadedRelease"
   SET status = 'UNAVAILABLE',
       error  = 'RuTracker source removed - will be re-searched on Soulseek',
       priority = 10, "torrentHash" = NULL, "torrentFolder" = NULL
 WHERE source = 'RUTRACKER'
   AND status IN ('SEARCHING', 'DOWNLOADING', 'ENRICHING');

-- 3. Drop the abstraction.
ALTER TABLE "DownloadedRelease"
  DROP COLUMN "source",
  DROP COLUMN "triedSources",
  DROP COLUMN "torrentHash",
  DROP COLUMN "torrentFolder";
DROP TABLE "DownloadSources";
DROP TYPE "DownloadSource";
ALTER TABLE "Settings"
  DROP COLUMN "prowlarrUrl",
  DROP COLUMN "prowlarrApiKey",
  DROP COLUMN "prowlarrIndexerId",
  DROP COLUMN "qbittorrentUrl",
  DROP COLUMN "qbittorrentUser",
  DROP COLUMN "qbittorrentPass",
  DROP COLUMN "qbittorrentSavePath";
