-- Gate the always-on FLAC->MP3-320 transcode step (server/utils/transcode.ts) behind a setting.
-- Nullable: NULL keeps the previous behaviour (env fallback, default on), so an existing install
-- converts exactly as before until the toggle is switched off in Settings -> Downloads.
ALTER TABLE "Settings" ADD COLUMN "flacToMp3" BOOLEAN;
