-- Target kbps for the FLAC->MP3 conversion step (server/utils/transcode.ts), configurable via
-- Settings -> Downloads -> Conversion. DEFAULT 320 applies to existing rows immediately and to
-- every new row, matching FLAC_TO_MP3_BITRATE's own default.
ALTER TABLE "Settings" ADD COLUMN "flacToMp3Bitrate" INTEGER DEFAULT 320;
