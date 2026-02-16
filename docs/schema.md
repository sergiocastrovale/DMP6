# Database Schema

The authoritative schema is at `web/prisma/schema.prisma`. This document provides a high-level overview.

## Core Models

### Artist

The primary entity. Each artist is extracted from audio file metadata during indexing.

```prisma
model Artist {
  id                String               @id @default(cuid())
  name              String
  slug              String               @unique
  image             String?              // Local path (web/public/img/artists/)
  imageUrl          String?              @db.Text  // S3 URL
  musicbrainzId     String?
  averageMatchScore Float?
  totalPlayCount    Int                  @default(0)
  totalTracks       Int                  @default(0)
  totalFileSize     BigInt               @default(0)
  lastSyncedAt      DateTime?
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt
  urls              ArtistUrl[]          @relation("ArtistUrls")
  localReleases     LocalRelease[]       @relation("ArtistLocalReleases")
  mbReleases        MusicBrainzRelease[] @relation("ArtistMbReleases")
  genres            Genre[]              @relation("ArtistGenres")
  trackArtists      TrackArtist[]        @relation("ArtistTracks")

  @@index([musicbrainzId])
}

```

**Key fields:**
- `image` / `imageUrl`: Supports both local and S3 storage (see `IMAGE_STORAGE` in `.env`)
- `musicbrainzId`: Populated during MusicBrainz sync
- `averageMatchScore`: Float (0.0–1.0) indicating catalogue completeness vs MusicBrainz

### ArtistUrl

External links for each artist (official site, Wikipedia, social media, etc.).

```prisma
model ArtistUrl {
  id        String   @id @default(cuid())
  type      String   // e.g., "official", "wikipedia", "discogs"
  url       String
  artistId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  artist    Artist   @relation("ArtistUrls", fields: [artistId], references: [id], onDelete: Cascade)

  @@unique([artistId, type, url])
  @@index([artistId])
}
```

### Genre

Genres/tags from MusicBrainz, linked to both artists and releases.

```prisma
model Genre {
  id       String               @id @default(cuid())
  name     String               @unique
  artists  Artist[]             @relation("ArtistGenres")
  releases MusicBrainzRelease[] @relation("ReleaseGenres")

  @@index([name])
}
```

### ReleaseType

Release categories (Album, EP, Live, Compilation, etc.).

```prisma
model ReleaseType {
  id        String               @id @default(cuid())
  name      String               @unique
  slug      String               @unique
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt
  mbReleases MusicBrainzRelease[]
}
```

## MusicBrainz Data

### MusicBrainzRelease

Official releases from MusicBrainz API.

```prisma
model MusicBrainzRelease {
  id             String                  @id @default(cuid())
  title          String                  @db.VarChar(500)
  artistId       String
  typeId         String
  year           Int?
  musicbrainzId  String?
  status         ReleaseStatus           @default(UNKNOWN)
  createdAt      DateTime                @default(now())
  updatedAt      DateTime                @updatedAt
  favorite       FavoriteRelease?
  localReleases  LocalRelease[]
  artist         Artist                  @relation("ArtistMbReleases", fields: [artistId], references: [id], onDelete: Cascade)
  type           ReleaseType             @relation(fields: [typeId], references: [id])
  genres         Genre[]                 @relation("ReleaseGenres")
  tracks         MusicBrainzReleaseTrack[]

  @@unique([artistId, title])
  @@index([typeId])
  @@index([musicbrainzId])
  @@map("musicbrainz_releases")
}
```

**Status values:**
- `COMPLETE`: All MB tracks found locally
- `INCOMPLETE`: Some tracks missing
- `EXTRA_TRACKS`: More local tracks than MB
- `MISSING`: Not in local catalogue
- `UNSYNCABLE`: No MB ID on local release
- `UNKNOWN`: Has MB ID but not found online

### MusicBrainzReleaseTrack

Individual tracks from MusicBrainz releases.

```prisma
model MusicBrainzReleaseTrack {
  id              String              @id @default(cuid())
  title           String              @db.VarChar(500)
  position        Int?
  discNumber      Int?
  durationMs      Int?
  musicbrainzId   String?
  releaseId       String
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  release         MusicBrainzRelease  @relation(fields: [releaseId], references: [id], onDelete: Cascade)
  localTracks     LocalReleaseTrack[] // Matched local tracks

  @@index([releaseId])
  @@index([musicbrainzId])
  @@map("musicbrainz_release_tracks")
}
```

## Local Catalogue

### LocalRelease

Releases extracted from local audio files, grouped by album name.

```prisma
model LocalRelease {
  id              String              @id @default(cuid())
  title           String              @db.VarChar(500)
  year            Int?
  artistId        String
  releaseId       String?             // FK to MusicBrainzRelease
  matchStatus     ReleaseStatus       @default(UNKNOWN)
  forcedComplete  Boolean             @default(false)  // Manual override
  folderPath      String?             @db.Text  // Relative to MUSIC_DIR
  image           String?             // Local path (web/public/img/releases/)
  imageUrl        String?             @db.Text  // S3 URL
  totalPlayCount  Int                 @default(0)
  totalDuration   Int?                @default(0)
  totalFileSize   BigInt              @default(0)
  lastPlayedAt    DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  artist          Artist              @relation("ArtistLocalReleases", fields: [artistId], references: [id], onDelete: Cascade)
  release         MusicBrainzRelease? @relation(fields: [releaseId], references: [id])
  tracks          LocalReleaseTrack[]

  @@unique([artistId, title])
  @@index([releaseId])
}
```

**Key fields:**
- `folderPath`: Relative path (portable across systems)
- `forcedComplete`: User override for status (e.g., accepting incomplete releases)
- `image` / `imageUrl`: Extracted from audio file metadata or fetched from API

### LocalReleaseTrack

Individual audio files from the local music library.

```prisma
model LocalReleaseTrack {
  id             String                   @id @default(cuid())
  title          String?                  @db.Text
  artist         String?                  @db.Text
  albumArtist    String?                  @db.Text
  album          String?                  @db.Text
  year           Int?
  genre          String?                  @db.Text
  duration       Int?
  bitrate        Int?
  sampleRate     Int?
  filePath       String                   @unique @db.VarChar(500)
  position       String?                  @db.Text
  trackNumber    Int?
  discNumber     Int?
  localReleaseId String?
  mbTrackId      String?                  // FK to MusicBrainzReleaseTrack
  fileSize       BigInt?
  mtime          DateTime?                // Last modified timestamp
  contentHash    String?                  @db.VarChar(32)  // MD5 of key fields
  metadata       Json?                    // Raw tags (for advanced queries)
  playCount      Int                      @default(0)
  lastPlayedAt   DateTime?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt
  localRelease   LocalRelease?            @relation(fields: [localReleaseId], references: [id], onDelete: Cascade)
  mbTrack        MusicBrainzReleaseTrack? @relation(fields: [mbTrackId], references: [id])
  favorite       FavoriteTrack?
  playlistTracks PlaylistTrack[]
  trackArtists   TrackArtist[]            @relation("TrackArtists")

  @@index([localReleaseId])
  @@index([mbTrackId])
  @@index([lastPlayedAt])
  @@index([contentHash])
  @@index([mtime])
}
```

**Change detection:**
- `mtime` + `fileSize`: Fast check for unchanged files
- `contentHash`: MD5 of normalized metadata fields (artist, album, title, year, track#, disc#, genre)

### TrackArtist

Links tracks to their artists (supports compilations and multi-artist releases).

```prisma
model TrackArtist {
  id        String            @id @default(cuid())
  trackId   String
  artistId  String
  role      TrackArtistRole   @default(PRIMARY)  // PRIMARY | ALBUM_ARTIST | FEATURED
  createdAt DateTime          @default(now())
  track     LocalReleaseTrack @relation("TrackArtists", fields: [trackId], references: [id], onDelete: Cascade)
  artist    Artist            @relation("ArtistTracks", fields: [artistId], references: [id], onDelete: Cascade)

  @@unique([trackId, artistId, role])
  @@index([trackId])
  @@index([artistId])
}
```

**Roles:**
- `PRIMARY`: Track artist (from "artist" tag)
- `ALBUM_ARTIST`: Album artist (from "album artist" tag)
- `FEATURED`: Featured artist

## User Data

### Playlist & PlaylistTrack

```prisma
model Playlist {
  id          String          @id @default(cuid())
  name        String
  description String?         @db.Text
  image       String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  tracks      PlaylistTrack[]
}

model PlaylistTrack {
  id         String            @id @default(cuid())
  position   Int
  playlistId String
  trackId    String
  createdAt  DateTime          @default(now())
  playlist   Playlist          @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  track      LocalReleaseTrack @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@unique([playlistId, trackId])
  @@index([playlistId])
  @@index([trackId])
}
```

### FavoriteRelease & FavoriteTrack

```prisma
model FavoriteRelease {
  id        String             @id @default(cuid())
  releaseId String             @unique
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
  release   MusicBrainzRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@index([releaseId])
}

model FavoriteTrack {
  id        String            @id @default(cuid())
  trackId   String            @unique
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  track     LocalReleaseTrack @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@index([trackId])
}
```

## System Tables

### Settings

```prisma
model Settings {
  id                String   @id @default("main")  // Singleton
  slskPath          String?
  slskUsername      String?
  slskPassword      String?
  slskDownloadDir   String?
  slskAllowedFormats String?
  slskMinBitrate    Int?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

### Statistics

```prisma
model Statistics {
  id                                  String    @id @default("main")  // Singleton
  artists                             Int       @default(0)
  playtime                            BigInt    @default(0)
  plays                               BigInt    @default(0)
  tracks                              Int       @default(0)
  releases                            Int       @default(0)
  genres                              Int       @default(0)
  artistsSyncedWithMusicbrainz        Int       @default(0)
  releasesSyncedWithMusicbrainz       Int       @default(0)
  artistsWithCoverArt                 Int       @default(0)
  releasesWithCoverArt                Int       @default(0)
  lastScanStartedAt                   DateTime?
  lastScanEndedAt                     DateTime?
  createdAt                           DateTime  @default(now())
  updatedAt                           DateTime  @updatedAt
}
```

### IndexCheckpoint

Enables resumable indexing after interruption.

```prisma
model IndexCheckpoint {
  id              String   @id @default("main")  // Singleton
  lastFolder      String?  @db.Text
  filesProcessed  Int      @default(0)
  musicDir        String?  @db.Text
  filterFrom      String?
  filterTo        String?
  filterOnly      String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Purpose**: The indexer saves progress every 100 files. If interrupted, use `--resume` to continue from the last checkpoint.

### S3DeletionQueue

Tracks pending image deletions from S3 and local storage.

```prisma
model S3DeletionQueue {
  id         String   @id @default(cuid())
  objectKey  String   // S3 key (e.g., "releases/abc123.jpg")
  createdAt  DateTime @default(now())

  @@index([createdAt])
}
```

**Purpose**: Database triggers populate this queue when artists or releases are deleted. The `./clean` script processes the queue and deletes orphaned images.

### SearchSource

```prisma
model SearchSource {
  id            String   @id @default(cuid())
  name          String   @unique
  baseUrl       String
  queryTemplate String
  isDefault     Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## Enums

```prisma
enum ReleaseStatus {
  COMPLETE      // All MB tracks found locally
  INCOMPLETE    // Some tracks missing
  EXTRA_TRACKS  // More local tracks than MB
  MISSING       // Not in local catalogue
  UNSYNCABLE    // No MB ID on local release
  UNKNOWN       // Has MB ID but not found online
}

enum TrackArtistRole {
  PRIMARY       // Track artist
  ALBUM_ARTIST  // Album artist
  FEATURED      // Featured artist
}
```

## Database Migrations

After modifying `web/prisma/schema.prisma`, apply changes:

```bash
cd web
pnpm prisma db push
```

For production, use migrations:

```bash
pnpm prisma migrate dev --name describe_your_change
```
