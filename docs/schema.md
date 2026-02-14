# Database schema

This is the schema from DMP v5. Most of it should still apply in v6, but feel free to optimize and change things as needed.

```js
model Artist {
  id                   String         		@id @default(cuid())
  name                 String
  slug                 String         		@unique
  image                String?
  imageUrl             String?        		@db.Text
  discogsId            Int?
  musicbrainzId        String?
  averageMatchScore    Int?
  totalPlayCount       Int            		@default(0)
  totalTracks          Int            		@default(0)
  totalFileSize        BigInt         		@default(0)
  lastSyncedAt         DateTime?
  createdAt            DateTime       		@default(now())
  updatedAt            DateTime       		@updatedAt
  urls                 ArtistUrl[]    		@relation("ArtistUrls")
  localReleases        LocalRelease[] 		@relation("ArtistLocalReleases")
  musicbrainzReleases  MusicBrainzRelease[] @relation("ArtistMusicBrainzReleases")
  genres               Genre[]        		@relation("ArtistGenres")
  trackArtists         TrackArtist[]  		@relation("ArtistTracks")
}

model ArtistUrl {
  id        String    @id @default(cuid())
  type      String
  url       String
  artistId  String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  artist    Artist    @relation("ArtistUrls", fields: [artistId], references: [id], onDelete: Cascade)

  @@unique([artistId, type, url])
  @@index([artistId])
}

model Genre {
  id       String      @id @default(cuid())
  name     String      @unique
  artists  Artist[]    @relation("ArtistGenres")
  releases Release[]   @relation("ReleaseGenres")

  @@index([name])
}

model ReleaseType {
  id        String    		@id @default(cuid())
  name      String    		@unique
  slug      String    		@unique
  createdAt DateTime  		@default(now())
  updatedAt DateTime  		@updatedAt
  musicbrainzReleases  		MusicBrainzRelease[]
}

model MusicBrainzRelease {
  id             String           @id @default(cuid())
  title          String           @db.VarChar(500)
  artistId       String
  typeId         String
  year    		 Int?
  discogsId      String?
  musicbrainzId  String?
  status         ReleaseStatus    @default(UNKNOWN)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  favorite       FavoriteRelease?
  localReleases  LocalRelease[]
  artist         Artist           @relation("ArtistReleases", fields: [artistId], references: [id])
  type           ReleaseType      @relation(fields: [typeId], references: [id])
  genres         Genre[]          @relation("ReleaseGenres")

  @@unique([artistId, title])
  @@index([typeId], map: "releases_typeId_fkey")
  @@map("releases")
}

model LocalRelease {
  id              String              @id @default(cuid())
  title           String              @db.VarChar(500)
  year     		  Int?
  discogsId       String?
  musicbrainzId   String?
  artistId        String
  releaseId       String?
  matchStatus     ReleaseStatus
  folderPath      String?             @db.Text
  image           String?
  totalPlayCount  Int                 @default(0)
  totalDuration   Int?                @default(0)
  totalFileSize   BigInt              @default(0)
  lastPlayedAt    DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  artist          Artist              @relation("ArtistLocalReleases", fields: [artistId], references: [id])
  release         Release?            @relation(fields: [releaseId], references: [id])
  tracks          LocalReleaseTrack[]

  @@unique([artistId, title])
}

model LocalReleaseTrack {
  id             String          @id @default(cuid())
  title          String?         @db.Text
  artist         String?         @db.Text
  albumArtist    String?         @db.Text
  album          String?         @db.Text
  year           Int?
  discogsId      String?
  musicbrainzId  String?
  genre          String?         @db.Text
  duration       Int?
  bitrate        Int?
  sampleRate     Int?
  filePath       String          @unique @db.VarChar(500)
  position       String?         @db.Text
  trackNumber    Int?
  discNumber     Int?
  localReleaseId String?
  fileSize       BigInt?
  mtime          DateTime?
  contentHash    String?         @db.VarChar(32)
  playCount      Int             @default(0)
  lastPlayedAt   DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  localRelease   LocalRelease?   @relation(fields: [localReleaseId], references: [id], onDelete: Cascade)
  favorite       FavoriteTrack?
  playlistTracks PlaylistTrack[]
  trackArtists   TrackArtist[]   @relation("TrackArtists")

  @@index([localReleaseId])
  @@index([lastPlayedAt])
  @@index([contentHash])
  @@index([mtime])
}

model SearchSource {
  id            String   @id @default(cuid())
  name          String   @unique
  baseUrl       String
  queryTemplate String
  isDefault     Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Settings {
  id                 String   @id @default("main")
  slskPath           String?
  slskUsername       String?
  slskPassword       String?
  slskDownloadDir    String?
  slskAllowedFormats String?
  slskMinBitrate     Int?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model Statistics {
  id                        String    @id @default("main")
  artists                   Int       @default(0)
  playtime                  BigInt    @default(0)
  plays                     BigInt    @default(0)
  localTracks               Int       @default(0)
  localReleases             Int       @default(0)
  genres                    Int       @default(0)
  artistsWithDiscogsId      Int       @default(0)
  artistsWithMusicbrainzId  Int       @default(0)
  artistsMatchedDiscogs     Int       @default(0)
  artistsMatchedMusicbrainz Int       @default(0)
  releasesWithCoverArt      Int       @default(0)
  lastScanStartedAt         DateTime?
  lastScanEndedAt           DateTime?
  lastIndexStartedAt        DateTime?
  lastIndexEndedAt          DateTime?
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt
}

model FavoriteRelease {
  id        String   @id @default(cuid())
  releaseId String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  release   Release  @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@index([releaseId])
}

model FavoriteTrack {
  id        String   @id @default(cuid())
  trackId   String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  track     LocalReleaseTrack @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@index([trackId])
}

model TrackArtist {
  id        String            @id @default(cuid())
  trackId   String
  artistId  String
  role      TrackArtistRole   @default(PRIMARY)
  createdAt DateTime          @default(now())
  track     LocalReleaseTrack @relation("TrackArtists", fields: [trackId], references: [id], onDelete: Cascade)
  artist    Artist            @relation("ArtistTracks", fields: [artistId], references: [id], onDelete: Cascade)

  @@unique([trackId, artistId, role])
  @@index([trackId])
  @@index([artistId])
}

enum ReleaseStatus {
  COMPLETE
  INCOMPLETE
  EXTRA_TRACKS 
  MISSING
  UNSYNCABLE
  UNKNOWN
}

enum TrackArtistRole {
  PRIMARY
  ALBUM_ARTIST
  FEATURED
}

```
