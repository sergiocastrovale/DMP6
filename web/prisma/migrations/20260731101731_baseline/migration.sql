-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('DETECTED', 'PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('COMPLETE', 'INCOMPLETE', 'EXTRA_TRACKS', 'MISSING_TRACKS', 'MISSING', 'UNKNOWN', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlaylistType" AS ENUM ('MANUAL', 'GENRE', 'REGION');

-- CreateEnum
CREATE TYPE "DownloadSource" AS ENUM ('SLSKD', 'RUTRACKER');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('DOWNLOADING', 'ENRICHING', 'READY', 'REJECTED', 'PROMOTED', 'FAILED', 'ABANDONED', 'UNAVAILABLE', 'INVALID');

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "image" TEXT,
    "imageUrl" TEXT,
    "musicbrainzId" TEXT,
    "averageMatchScore" DOUBLE PRECISION,
    "totalPlayCount" INTEGER NOT NULL DEFAULT 0,
    "totalTracks" INTEGER NOT NULL DEFAULT 0,
    "totalFileSize" BIGINT NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "country" VARCHAR(2),
    "syncHash" TEXT,
    "relatedOnly" BOOLEAN NOT NULL DEFAULT false,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "lastGapsCheckedAt" TIMESTAMP(3),
    "primaryArtistId" TEXT,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistUrl" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicBrainzRelease" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "typeId" TEXT NOT NULL,
    "year" INTEGER,
    "musicbrainzId" TEXT NOT NULL,
    "releaseGroupId" TEXT,
    "disambiguation" TEXT,
    "editionLabel" TEXT,
    "releaseDate" TEXT,
    "packaging" TEXT,
    "country" TEXT,
    "format" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'UNKNOWN',
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicBrainzRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicBrainzReleaseTrack" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "position" INTEGER,
    "discNumber" INTEGER,
    "durationMs" INTEGER,
    "musicbrainzId" TEXT,
    "releaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicBrainzReleaseTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalRelease" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "year" INTEGER,
    "releaseId" TEXT,
    "matchStatus" "ReleaseStatus" NOT NULL DEFAULT 'UNMATCHED',
    "forcedComplete" BOOLEAN NOT NULL DEFAULT false,
    "folderPath" TEXT,
    "groupKey" VARCHAR(500) NOT NULL,
    "image" TEXT,
    "imageUrl" TEXT,
    "totalPlayCount" INTEGER NOT NULL DEFAULT 0,
    "totalDuration" INTEGER DEFAULT 0,
    "totalFileSize" BIGINT NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "downloadedFrom" TEXT,

    CONSTRAINT "LocalRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalReleaseArtist" (
    "id" TEXT NOT NULL,
    "localReleaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalReleaseArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicBrainzReleaseArtist" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicBrainzReleaseArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalReleaseTrack" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "artist" TEXT,
    "albumArtist" TEXT,
    "album" TEXT,
    "year" INTEGER,
    "genre" TEXT,
    "duration" INTEGER,
    "bitrate" INTEGER,
    "sampleRate" INTEGER,
    "filePath" VARCHAR(500) NOT NULL,
    "position" TEXT,
    "trackNumber" INTEGER,
    "discNumber" INTEGER,
    "localReleaseId" TEXT,
    "mbTrackId" TEXT,
    "mbReleaseGroupId" TEXT,
    "mbReleaseId" TEXT,
    "mbAlbumArtistId" TEXT,
    "fileSize" BIGINT,
    "mtime" TIMESTAMP(3),
    "contentHash" VARCHAR(32),
    "metadata" JSONB,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalReleaseTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackRelatedArtist" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackRelatedArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "type" "PlaylistType" NOT NULL DEFAULT 'MANUAL',
    "genreGroup" TEXT,
    "regionGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistTrack" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteRelease" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoriteRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteTrack" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoriteTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "queryTemplate" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "musicDir" TEXT,
    "slskdUrl" TEXT,
    "slskdApiKey" TEXT,
    "downloadsPath" TEXT,
    "downloadDirTemplate" TEXT,
    "downloadFormats" TEXT,
    "downloadMinBitrate" INTEGER,
    "prowlarrUrl" TEXT,
    "prowlarrApiKey" TEXT,
    "prowlarrIndexerId" TEXT,
    "qbittorrentUrl" TEXT,
    "qbittorrentUser" TEXT,
    "qbittorrentPass" TEXT,
    "qbittorrentSavePath" TEXT,
    "monitorEnabled" BOOLEAN,
    "monitorIntervalMin" INTEGER,
    "monitorCap" INTEGER,
    "monitorGapsHours" INTEGER,
    "retryCooldownDays" INTEGER,
    "noProgressSec" INTEGER,
    "maxDownloadAttempts" INTEGER,
    "songkongEnabled" BOOLEAN,
    "autoMergeDownloads" BOOLEAN,
    "maxConcurrentDownloads" INTEGER,
    "searchPicksPerInterval" INTEGER,
    "searchIntervalSec" INTEGER,
    "gapsPicksPerRun" INTEGER,
    "gapsIntervalMin" INTEGER,
    "downloadsPaused" BOOLEAN NOT NULL DEFAULT false,
    "downloadsPausedReason" TEXT,
    "imageStorage" TEXT,
    "storageImageBucket" TEXT,
    "storageBackupsBucket" TEXT,
    "awsRegion" TEXT,
    "awsAccessKeyId" TEXT,
    "awsSecretAccessKey" TEXT,
    "storageEndpoint" TEXT,
    "storagePublicUrl" TEXT,
    "fanartApiKey" TEXT,
    "indexRunHash" TEXT,
    "syncRunHash" TEXT,
    "lastfmApiKey" TEXT,
    "lastfmSecret" TEXT,
    "lastfmSessionKey" TEXT,
    "lastfmUsername" TEXT,
    "showTerminal" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadSources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "retry" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "budgetUsed" INTEGER NOT NULL DEFAULT 0,
    "budgetWindowStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DownloadSources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadedRelease" (
    "id" TEXT NOT NULL,
    "artistId" TEXT,
    "mbReleaseId" TEXT,
    "releaseGroupId" TEXT,
    "title" VARCHAR(500) NOT NULL,
    "year" INTEGER,
    "source" "DownloadSource" NOT NULL DEFAULT 'SLSKD',
    "triedSources" "DownloadSource"[] DEFAULT ARRAY[]::"DownloadSource"[],
    "slskUsername" TEXT,
    "torrentHash" TEXT,
    "torrentFolder" TEXT,
    "quality" TEXT,
    "files" JSONB,
    "stagingPath" TEXT,
    "status" "DownloadStatus" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "bytesTransferred" BIGINT NOT NULL DEFAULT 0,
    "lastProgressAt" TIMESTAMP(3),
    "error" TEXT,
    "localReleaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DownloadedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statistics" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "artists" INTEGER NOT NULL DEFAULT 0,
    "mainArtists" INTEGER NOT NULL DEFAULT 0,
    "relatedArtists" INTEGER NOT NULL DEFAULT 0,
    "playtime" BIGINT NOT NULL DEFAULT 0,
    "plays" BIGINT NOT NULL DEFAULT 0,
    "tracks" INTEGER NOT NULL DEFAULT 0,
    "releases" INTEGER NOT NULL DEFAULT 0,
    "genres" INTEGER NOT NULL DEFAULT 0,
    "artistsSyncedWithMusicbrainz" INTEGER NOT NULL DEFAULT 0,
    "releasesSyncedWithMusicbrainz" INTEGER NOT NULL DEFAULT 0,
    "artistsWithCoverArt" INTEGER NOT NULL DEFAULT 0,
    "releasesWithCoverArt" INTEGER NOT NULL DEFAULT 0,
    "totalFileSize" BIGINT NOT NULL DEFAULT 0,
    "lastScanStartedAt" TIMESTAMP(3),
    "lastScanEndedAt" TIMESTAMP(3),
    "lastSyncedArtist" TEXT,
    "lastSyncArgs" JSONB,
    "lastIndexedFolder" TEXT,
    "scanLockedBy" TEXT,
    "scanLockedAt" TIMESTAMP(3),
    "scanPid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderScan" (
    "folderPath" TEXT NOT NULL,
    "mtime" TIMESTAMP(3) NOT NULL,
    "indexHash" TEXT,

    CONSTRAINT "FolderScan_pkey" PRIMARY KEY ("folderPath")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "counts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueCorruptedTpe2" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "trackId" TEXT NOT NULL,
    "currentValue" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueCorruptedTpe2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueUnsplitArtist" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "artistId" TEXT NOT NULL,
    "separator" TEXT NOT NULL,
    "proposedParts" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueUnsplitArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueOrphanArtist" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "artistId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueOrphanArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueDuplicateArtist" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "artistAId" TEXT NOT NULL,
    "artistBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueDuplicateArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueMissingMetadata" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "trackId" TEXT NOT NULL,
    "missingFields" TEXT[],
    "proposedValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueMissingMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEnrichmentGap" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DETECTED',
    "localReleaseId" TEXT NOT NULL,
    "missingFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueEnrichmentGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixHistory" (
    "id" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "previousState" JSONB NOT NULL,
    "appliedState" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" SERIAL NOT NULL,
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorEvent" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ArtistGenres" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ArtistGenres_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ReleaseGenres" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReleaseGenres_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_slug_key" ON "Artist"("slug");

-- CreateIndex
CREATE INDEX "Artist_musicbrainzId_idx" ON "Artist"("musicbrainzId");

-- CreateIndex
CREATE INDEX "Artist_totalPlayCount_idx" ON "Artist"("totalPlayCount");

-- CreateIndex
CREATE INDEX "Artist_averageMatchScore_idx" ON "Artist"("averageMatchScore");

-- CreateIndex
CREATE INDEX "Artist_createdAt_idx" ON "Artist"("createdAt");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- CreateIndex
CREATE INDEX "Artist_country_idx" ON "Artist"("country");

-- CreateIndex
CREATE INDEX "Artist_relatedOnly_idx" ON "Artist"("relatedOnly");

-- CreateIndex
CREATE INDEX "Artist_monitored_lastGapsCheckedAt_idx" ON "Artist"("monitored", "lastGapsCheckedAt");

-- CreateIndex
CREATE INDEX "Artist_monitored_idx" ON "Artist"("monitored");

-- CreateIndex
CREATE INDEX "Artist_primaryArtistId_idx" ON "Artist"("primaryArtistId");

-- CreateIndex
CREATE INDEX "ArtistUrl_artistId_idx" ON "ArtistUrl"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistUrl_artistId_type_url_key" ON "ArtistUrl"("artistId", "type", "url");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_name_key" ON "Genre"("name");

-- CreateIndex
CREATE INDEX "Genre_name_idx" ON "Genre"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseType_name_key" ON "ReleaseType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseType_slug_key" ON "ReleaseType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MusicBrainzRelease_musicbrainzId_key" ON "MusicBrainzRelease"("musicbrainzId");

-- CreateIndex
CREATE INDEX "MusicBrainzRelease_typeId_idx" ON "MusicBrainzRelease"("typeId");

-- CreateIndex
CREATE INDEX "MusicBrainzRelease_releaseGroupId_idx" ON "MusicBrainzRelease"("releaseGroupId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseTrack_releaseId_idx" ON "MusicBrainzReleaseTrack"("releaseId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseTrack_musicbrainzId_idx" ON "MusicBrainzReleaseTrack"("musicbrainzId");

-- CreateIndex
CREATE INDEX "LocalRelease_releaseId_idx" ON "LocalRelease"("releaseId");

-- CreateIndex
CREATE INDEX "LocalRelease_year_idx" ON "LocalRelease"("year");

-- CreateIndex
CREATE INDEX "LocalRelease_createdAt_idx" ON "LocalRelease"("createdAt");

-- CreateIndex
CREATE INDEX "LocalRelease_lastPlayedAt_idx" ON "LocalRelease"("lastPlayedAt");

-- CreateIndex
CREATE INDEX "LocalRelease_downloadedFrom_idx" ON "LocalRelease"("downloadedFrom");

-- CreateIndex
CREATE INDEX "LocalRelease_title_idx" ON "LocalRelease"("title");

-- CreateIndex
CREATE UNIQUE INDEX "LocalRelease_groupKey_key" ON "LocalRelease"("groupKey");

-- CreateIndex
CREATE INDEX "LocalReleaseArtist_localReleaseId_idx" ON "LocalReleaseArtist"("localReleaseId");

-- CreateIndex
CREATE INDEX "LocalReleaseArtist_artistId_idx" ON "LocalReleaseArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalReleaseArtist_localReleaseId_artistId_key" ON "LocalReleaseArtist"("localReleaseId", "artistId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseArtist_releaseId_idx" ON "MusicBrainzReleaseArtist"("releaseId");

-- CreateIndex
CREATE INDEX "MusicBrainzReleaseArtist_artistId_idx" ON "MusicBrainzReleaseArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicBrainzReleaseArtist_releaseId_artistId_key" ON "MusicBrainzReleaseArtist"("releaseId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalReleaseTrack_filePath_key" ON "LocalReleaseTrack"("filePath");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_localReleaseId_idx" ON "LocalReleaseTrack"("localReleaseId");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_mbTrackId_idx" ON "LocalReleaseTrack"("mbTrackId");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_lastPlayedAt_idx" ON "LocalReleaseTrack"("lastPlayedAt");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_contentHash_idx" ON "LocalReleaseTrack"("contentHash");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_mtime_idx" ON "LocalReleaseTrack"("mtime");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_year_idx" ON "LocalReleaseTrack"("year");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_year_genre_idx" ON "LocalReleaseTrack"("year", "genre");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_playCount_idx" ON "LocalReleaseTrack"("playCount");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_genre_idx" ON "LocalReleaseTrack"("genre");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_localReleaseId_discNumber_trackNumber_idx" ON "LocalReleaseTrack"("localReleaseId", "discNumber", "trackNumber");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_mbReleaseGroupId_idx" ON "LocalReleaseTrack"("mbReleaseGroupId");

-- CreateIndex
CREATE INDEX "LocalReleaseTrack_mbReleaseId_idx" ON "LocalReleaseTrack"("mbReleaseId");

-- CreateIndex
CREATE INDEX "TrackRelatedArtist_trackId_idx" ON "TrackRelatedArtist"("trackId");

-- CreateIndex
CREATE INDEX "TrackRelatedArtist_artistId_idx" ON "TrackRelatedArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackRelatedArtist_trackId_artistId_key" ON "TrackRelatedArtist"("trackId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_slug_key" ON "Playlist"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_genreGroup_key" ON "Playlist"("genreGroup");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_regionGroup_key" ON "Playlist"("regionGroup");

-- CreateIndex
CREATE INDEX "PlaylistTrack_playlistId_idx" ON "PlaylistTrack"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistTrack_trackId_idx" ON "PlaylistTrack"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_trackId_key" ON "PlaylistTrack"("playlistId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteRelease_releaseId_key" ON "FavoriteRelease"("releaseId");

-- CreateIndex
CREATE INDEX "FavoriteRelease_releaseId_idx" ON "FavoriteRelease"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteTrack_trackId_key" ON "FavoriteTrack"("trackId");

-- CreateIndex
CREATE INDEX "FavoriteTrack_trackId_idx" ON "FavoriteTrack"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSource_name_key" ON "SearchSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadSources_name_key" ON "DownloadSources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadedRelease_localReleaseId_key" ON "DownloadedRelease"("localReleaseId");

-- CreateIndex
CREATE INDEX "DownloadedRelease_status_idx" ON "DownloadedRelease"("status");

-- CreateIndex
CREATE INDEX "DownloadedRelease_status_priority_idx" ON "DownloadedRelease"("status", "priority");

-- CreateIndex
CREATE INDEX "DownloadedRelease_artistId_idx" ON "DownloadedRelease"("artistId");

-- CreateIndex
CREATE INDEX "DownloadedRelease_mbReleaseId_idx" ON "DownloadedRelease"("mbReleaseId");

-- CreateIndex
CREATE INDEX "DownloadedRelease_createdAt_idx" ON "DownloadedRelease"("createdAt");

-- CreateIndex
CREATE INDEX "IssueCorruptedTpe2_status_idx" ON "IssueCorruptedTpe2"("status");

-- CreateIndex
CREATE INDEX "IssueCorruptedTpe2_auditRunId_idx" ON "IssueCorruptedTpe2"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueUnsplitArtist_status_idx" ON "IssueUnsplitArtist"("status");

-- CreateIndex
CREATE INDEX "IssueUnsplitArtist_auditRunId_idx" ON "IssueUnsplitArtist"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueOrphanArtist_status_idx" ON "IssueOrphanArtist"("status");

-- CreateIndex
CREATE INDEX "IssueOrphanArtist_auditRunId_idx" ON "IssueOrphanArtist"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueDuplicateArtist_status_idx" ON "IssueDuplicateArtist"("status");

-- CreateIndex
CREATE INDEX "IssueDuplicateArtist_auditRunId_idx" ON "IssueDuplicateArtist"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueMissingMetadata_status_idx" ON "IssueMissingMetadata"("status");

-- CreateIndex
CREATE INDEX "IssueMissingMetadata_auditRunId_idx" ON "IssueMissingMetadata"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueEnrichmentGap_status_idx" ON "IssueEnrichmentGap"("status");

-- CreateIndex
CREATE INDEX "IssueEnrichmentGap_auditRunId_idx" ON "IssueEnrichmentGap"("auditRunId");

-- CreateIndex
CREATE INDEX "IssueEnrichmentGap_localReleaseId_idx" ON "IssueEnrichmentGap"("localReleaseId");

-- CreateIndex
CREATE INDEX "FixHistory_issueId_idx" ON "FixHistory"("issueId");

-- CreateIndex
CREATE INDEX "FixHistory_issueType_revertedAt_idx" ON "FixHistory"("issueType", "revertedAt");

-- CreateIndex
CREATE INDEX "FixHistory_filePath_idx" ON "FixHistory"("filePath");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permission_key" ON "RolePermission"("role", "permission");

-- CreateIndex
CREATE INDEX "MonitorEvent_createdAt_idx" ON "MonitorEvent"("createdAt");

-- CreateIndex
CREATE INDEX "_ArtistGenres_B_index" ON "_ArtistGenres"("B");

-- CreateIndex
CREATE INDEX "_ReleaseGenres_B_index" ON "_ReleaseGenres"("B");

-- AddForeignKey
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_primaryArtistId_fkey" FOREIGN KEY ("primaryArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistUrl" ADD CONSTRAINT "ArtistUrl_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicBrainzRelease" ADD CONSTRAINT "MusicBrainzRelease_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ReleaseType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicBrainzReleaseTrack" ADD CONSTRAINT "MusicBrainzReleaseTrack_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRelease" ADD CONSTRAINT "LocalRelease_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReleaseArtist" ADD CONSTRAINT "LocalReleaseArtist_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReleaseArtist" ADD CONSTRAINT "LocalReleaseArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicBrainzReleaseArtist" ADD CONSTRAINT "MusicBrainzReleaseArtist_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicBrainzReleaseArtist" ADD CONSTRAINT "MusicBrainzReleaseArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReleaseTrack" ADD CONSTRAINT "LocalReleaseTrack_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReleaseTrack" ADD CONSTRAINT "LocalReleaseTrack_mbTrackId_fkey" FOREIGN KEY ("mbTrackId") REFERENCES "MusicBrainzReleaseTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackRelatedArtist" ADD CONSTRAINT "TrackRelatedArtist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackRelatedArtist" ADD CONSTRAINT "TrackRelatedArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteRelease" ADD CONSTRAINT "FavoriteRelease_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteTrack" ADD CONSTRAINT "FavoriteTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadedRelease" ADD CONSTRAINT "DownloadedRelease_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadedRelease" ADD CONSTRAINT "DownloadedRelease_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCorruptedTpe2" ADD CONSTRAINT "IssueCorruptedTpe2_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCorruptedTpe2" ADD CONSTRAINT "IssueCorruptedTpe2_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueUnsplitArtist" ADD CONSTRAINT "IssueUnsplitArtist_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueUnsplitArtist" ADD CONSTRAINT "IssueUnsplitArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOrphanArtist" ADD CONSTRAINT "IssueOrphanArtist_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOrphanArtist" ADD CONSTRAINT "IssueOrphanArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDuplicateArtist" ADD CONSTRAINT "IssueDuplicateArtist_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDuplicateArtist" ADD CONSTRAINT "IssueDuplicateArtist_artistAId_fkey" FOREIGN KEY ("artistAId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDuplicateArtist" ADD CONSTRAINT "IssueDuplicateArtist_artistBId_fkey" FOREIGN KEY ("artistBId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMissingMetadata" ADD CONSTRAINT "IssueMissingMetadata_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMissingMetadata" ADD CONSTRAINT "IssueMissingMetadata_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "LocalReleaseTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEnrichmentGap" ADD CONSTRAINT "IssueEnrichmentGap_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEnrichmentGap" ADD CONSTRAINT "IssueEnrichmentGap_localReleaseId_fkey" FOREIGN KEY ("localReleaseId") REFERENCES "LocalRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArtistGenres" ADD CONSTRAINT "_ArtistGenres_A_fkey" FOREIGN KEY ("A") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArtistGenres" ADD CONSTRAINT "_ArtistGenres_B_fkey" FOREIGN KEY ("B") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseGenres" ADD CONSTRAINT "_ReleaseGenres_A_fkey" FOREIGN KEY ("A") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseGenres" ADD CONSTRAINT "_ReleaseGenres_B_fkey" FOREIGN KEY ("B") REFERENCES "MusicBrainzRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
