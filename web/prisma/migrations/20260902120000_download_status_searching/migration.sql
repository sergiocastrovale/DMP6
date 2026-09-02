-- A DownloadedRelease row was set to DOWNLOADING the instant it was created, before the source
-- search (slskd/RuTracker) had actually found anything - so the UI showed "Downloading" while
-- nothing was transferring yet. SEARCHING covers that window; rows flip to DOWNLOADING only once
-- a real match is confirmed and the transfer starts.
ALTER TYPE "DownloadStatus" ADD VALUE 'SEARCHING';
