# DMP v6 scripts

Scripts are built with Node so that we can leverage Prisma ORM and work with the database in the same manner as the web app.

## Overview

DMP v6 uses an **index-first, query-driven architecture**. The filesystem is scanned once to build a database index, and all subsequent operations (syncing, matching, cover fetching) work from the database rather than rescanning files.

### Scripts Summary

| Script | Command | Internet | Purpose |
|--------|---------|----------|---------|
| Indexer | `pnpm index` | No | Scan files, extract metadata, build local catalogue |
| Sync | `pnpm sync` | Yes | Fetch MusicBrainz data, match releases |
| Cleanup | `pnpm cleanup` | No | Remove orphaned records (deleted files) |
| Nuke | `pnpm nuke` | No | Completely remove artists and all data |
| Images (Artists) | `pnpm img` | Yes | Download artist photos from Wikipedia |
| Statistics | `pnpm stats` | No | Calculate and store library statistics |
| Missing metadata analysis | `pnpm missing` | Yes | Finds missing critical metadata in each file and builds CSV report |


## Script 1: Indexer (`pnpm index`)

Scans your music directory and builds the local catalogue in the database. Works completely offline.

### What it does

1. Walks through `MUSIC_DIR` (from .env) recursively
2. Finds all `.mp3`, `.flac`, `.aac`, `.opus`, `.m4a` files
3. Extracts metadata using `music-metadata` library
4. Creates/updates `LocalReleaseTrack` records
5. **Creates TrackArtist relationships** linking each track to its artist(s)
6. Groups tracks into `LocalRelease` records by album name
7. **Extracts embedded cover art** from first track of each album, saves to `public/img/releases/`, stores path in `LocalRelease.image`
8. Creates `Artist` records automatically

**Overwrite mode**: When using `--overwrite`, the indexer first runs `pnpm nuke` with the same filters to completely remove all existing data (artists, releases, tracks, and image files) before re-indexing. This ensures a clean slate.

**TrackArtist relationships**: Each track is linked to its artists via the `TrackArtist` table:
- `PRIMARY` role: The track artist (from the "artist" tag)
- `ALBUM_ARTIST` role: The album artist (if different from track artist)

This enables compilations to appear in an artist's catalogue. A Radiohead track on "Best of 90s Alt Rock" (album artist: "Various Artists") will show up in Radiohead's Compilations tab.

**Cover art flow**: During sync, when a `LocalRelease` matches a `Release`, the cover is automatically copied (`LocalRelease.image` → `Release.image`). This means most covers are handled without any API calls.

### Change Detection

The indexer uses a multi-layer change detection system for efficiency:

1. **mtime + fileSize**: Fast check - if both match, skip the file
2. **contentHash**: If mtime/size changed, extract metadata and compare hash
3. **contentHash formula**: `md5(artist|albumArtist|album|title|year|trackNumber|discNumber|genre)` normalized to lowercase

This means:
- Unchanged files are skipped instantly (no metadata extraction)
- Files with minor attribute changes (permissions, etc.) are still skipped
- Any metadata change (title fix, genre update, track reordering, etc.) triggers re-indexing

### Usage

```bash
pnpm index
pnpm index --resume
pnpm index --overwrite
pnpm index --only="Radiohead"
pnpm index --from="A" --to="D"
pnpm index --overwrite --only="Radiohead"
```

### Flags

| Flag | Description |
|------|-------------|
| `--resume` | Continue from last checkpoint after interruption |
| `--overwrite` | Nuke matching artists (delete all data + images), then re-index from scratch |
| `--sequential` | Process files one at a time instead of in parallel (default: parallel with 50 concurrent) |
| `--only=<name>` | Only index artists starting with this prefix |
| `--from=<name>` | Start from artists >= this prefix |
| `--to=<name>` | Stop at artists <= this prefix |

### Parallel Processing

By default, the indexer processes files in parallel (50 concurrent operations) for maximum speed. This is typically 5-10x faster than sequential processing.

Use `--sequential` if you experience issues with parallel processing (e.g., database connection limits, memory pressure on low-RAM systems).

### Orphan Cleanup

Orphaned records (tracks whose files were deleted from disk) are handled by a separate script: `pnpm cleanup`. This keeps the indexer focused on scanning and extracting metadata.

See the **Cleanup** section below for details.

### Keyboard Controls

- Press **Q** during indexing to gracefully stop and save checkpoint
- Press **Ctrl+C** to force quit (no checkpoint saved)

### Checkpoint System

The indexer saves progress to the database every 100 files. If interrupted:

1. Progress is saved to `IndexCheckpoint` table
2. Run `pnpm index --resume` to continue from where you left off
3. No files are processed twice

### Error Handling

- Any errors (such as files with missing/invalid metadata) are logged to `errors.log`
- Each error is prefixed with `[INDEXER]`
- Errors don't stop the indexing process
- Example errors: missing artist tag, missing album tag, corrupt file


## Script 2: Cleanup (`pnpm cleanup`)

Removes orphaned records from the database - tracks whose files no longer exist on disk.

### What it does

1. Scans all `LocalReleaseTrack` records (or filtered subset)
2. Checks if the file exists on disk
3. Deletes orphaned tracks from database
4. Deletes `LocalRelease` records that have no remaining tracks
5. Updates `totalDuration` and `totalFileSize` for affected releases

### Usage

```bash
pnpm cleanup                       # Full library
pnpm cleanup --only="Radiohead"    # Only artists starting with "Radiohead"
pnpm cleanup --from="A" --to="M"   # Artists from A to L
```

### Flags

| Flag | Description |
|------|-------------|
| `--only=<name>` | Only cleanup artists starting with this prefix |
| `--from=<name>` | Start from artists >= this prefix |
| `--to=<name>` | Stop at artists < this prefix |

### Keyboard Controls

- Press **Q** to gracefully stop
- Press **Ctrl+C** or press **X** twice to force quit


## Script 3: Nuke (`pnpm nuke`)

Completely removes artists and all their data from the database, including image files.

### What it does

1. Finds artists matching the filter criteria
2. For each artist:
   - Deletes all `Release` records and their cover images
   - Deletes all `LocalRelease` records and their cover images
   - Deletes all `LocalReleaseTrack` records
   - Deletes all `ArtistUrl` records
   - Deletes the artist image
   - Deletes the `Artist` record

### Usage

```bash
pnpm nuke
pnpm nuke --only="Radiohead"
pnpm nuke --from="A" --to="M"
```

**Note:** At least one filter is required for safety.

### Flags

| Flag | Description |
|------|-------------|
| `--only=<name>` | Only nuke artists starting with this prefix |
| `--from=<name>` | Start from artists >= this prefix |
| `--to=<name>` | Stop at artists < this prefix |

### Keyboard Controls

- Press **Q** to gracefully stop
- Press **Ctrl+C** or press **X** twice to force quit


## Script 4: Sync (`pnpm sync`)

Fetches artist discographies from MusicBrainz and matches local releases against the musicbrainz catalogue.

### What it does

1. Finds artists where `needsMbSync = true` (or all with `--overwrite`)
2. For each artist:
   - Searches MusicBrainz for artist ID if missing
   - Fetches complete discography (release groups)
   - Filters out unwanted types (singles, bootlegs, demos, unofficial releases, interviews, broadcasts)
   - Creates `Release` records with MB data
   - Stores genres/tags from MB
   - Stores external links (official site, social media, etc.)
3. Matches `LocalRelease` records to `Release` records
4. Updates match status

### Indexing method

For each file, we extract and store:

- File path
- File size
- Last modified time (mtime)
- Content hash (comprised of artist + album name + release year)

We need to be able to compare the library index when new things are added or modified.

After the initial scan, the system switches to change detection.

On each scan:

1. Walk the filesystem
2. For each file:
   - If path is new → process as new file  
   - If mtime, size or content hash changed → re-read tags  
   - Otherwise → skip  

If there are changes, recompute the content hash. If different:
- Update track metadata
- Update track ↔ artist relationships
- Mark related entities as “dirty” for reprocessing

### Status check

Once we have both local and musicbrainz catalogues, we must match each musicbrainz release against the local catalogue and perform some tasks.

`COMPLETE`: we have all the musicbrainz tracks of a release in our local library.

`INCOMPLETE`: we LESS than all the tracks of an musicbrainz release in our local library. We must store the track names of each track we are missing in the DB, so that we can later present the list in a dialog in the UI.

`EXTRA_TRACKS`: we have MORE than the tracks of an musicbrainz release in our local library. We must store the track names of each track we are missing in the DB, so that we can later present the list in a dialog in the UI.

`MISSING`: this musicbrainz release is missing from our local catalogue.

`UNSYNCABLE`: we are missing the MB ID so we can't find it online.

`UNKNOWN`: we do have MB ID, but we could not find this online.

#### Status check override

We need a way to force the app to accept an incomplete or mismatched release as "correct". This should be stored in a `forced_complete` boolean field in the DB in LocalRelease.

In the UI, this will be done in the form of a "Mark as complete" button. Once we mark something as complete, the `status` will be ignored, and we'll force the UI to show the status `FORCED_COMPLETE`. Clicking the button again should set this flag to false, and the status should be reassessed and go back to normal.

### Release Types

Release types are stored exactly as MusicBrainz returns them. No filtering or transformation is applied.

**Skipped:**
- Releases with "Single" as primary or secondary type

**Examples:**
- `Album` (no secondary types)
- `Compilation` (from "Album + Compilation")
- `Live` (from "Album + Live" or "EP + Live")
- `Live, Compilation` (multiple secondary types)
- `EP` (no secondary types)

When secondary types exist, only those are shown. The frontend displays each unique type as a separate tab.

### Match score

For each artist we will want to calculate an `averageMatchScore`. This score should tell us "how much of the musicbrainz catalogue do we have locally?" (float as percentage, between 0.0 and 1.0).

The way to calculate this is derived from the sum of the status of each release:

`COMPLETE`: 1.0

`INCOMPLETE`: Percentage of missing tracks. If a release has 10 tracks and we only have 8 locally, the score is 0.8

`EXTRA_TRACKS`: 1.0 

`MISSING`: 0.0

`UNSYNCABLE`: 0.0

`UNKNOWN`: 0.0

### Usage

```bash
pnpm sync
pnpm sync --overwrite
pnpm sync --only="Radiohead"
pnpm sync --from="A" --to="M"
pnpm sync --from="Abe" --to="Car"
pnpm sync --only="Air" --overwrite
```

### Flags

| Flag | Description |
|------|-------------|
| `--overwrite` | Re-sync all artists (ignore needsMbSync flag) |
| `--only=<name>` | Only sync artists starting with this prefix |
| `--from=<name>` | Start from artists >= this prefix |
| `--to=<name>` | Stop at artists <= this prefix |

### Rate Limiting

MusicBrainz requires max 1 request per second. The sync script:
- Enforces 1.1 second delay between requests
- Automatically retries on 503 errors
- Handles rate limit gracefully

### Error Handling

- Errors are logged to `errors.log`
- Each error is prefixed with `[SYNC]`
- Errors don't stop the sync process
- Artist is marked as needing re-sync on error

### Artist Images (`pnpm img`)

Downloads artist photos from Wikipedia.

#### How it works

1. Finds artists without `image` field set
2. For each artist with a MusicBrainz ID:
   - Fetches artist data from MB
   - Looks for Wikipedia relation
   - Stores the original URL in `Artist.imageUrl`
   - Fetches thumbnail from Wikipedia API
   - Resizes to 128x128 JPEG
   - Saves to `public/img/artists/{slug}.jpg`
   - Updates `Artist.image` in database

#### Usage

```bash
pnpm img
pnpm img --overwrite
pnpm img --only="Radiohead"
pnpm img --from="A" --to="M"
pnpm img --from="Abe" --to="Car"
pnpm img --only="Air" --overwrite
```

## Script 6: Statistics (`pnpm stats`)

Calculates comprehensive library statistics and stores them in the database.

### Calculated Stats

#### Library Overview
- `artists`: Total artist count
- `localTracks`: Total track count
- `localReleases`: Total local release count
- `genres`: Total genre count
- `playtime`: Total duration of all tracks (in seconds)
- `plays`: Total play count across all tracks

#### Artist Stats
- `artistsWithMusicbrainzId`: Artists matched to MusicBrainz
- `artistsWithDiscogsId`: Artists matched to Discogs

#### Cover Art Stats
- `releasesWithCoverArt`: Releases with any cover
- `coversFromMetadata`: Covers extracted from audio files (image set, imageUrl null)
- `coversFromApi`: Covers fetched from Cover Art Archive (both image and imageUrl set)

#### Match Statistics
- Breakdown by `matchStatus` (PERFECT_MATCH, TITLE_MATCH, etc.)

#### Release Type Statistics
- Breakdown by release type (Album, EP, Live, etc.)

### Usage

```bash
pnpm stats
```

Always overwrites the `Statistics` table with current values.

## Script 7: Find missing data (`pnpm missing`)

Checks for missing metadata fields (stored in the JSON field `LocalReleaseTrack.metadata`) and creates a CSV file listing them.

⚠️ Some meta tags have different names depending on the tagging tool! 

### CSV file

Files should be stored in `reports/missing_[timestamp].csv`

### Usage

* Musicbrainz Critical Fields: `MusicBrainz Artist Id` or `MUSICBRAINZ_ARTISTID`, `MusicBrainz Release Track Id` or `MUSICBRAINZ_TRACKID`, `MusicBrainz Album Id` or `MUSICBRAINZ_ALBUMID`

* Critical fields: `Artist`, `Title`, `Year` and all Musicbrainz Critical Fields

```
# # Finds all files with missing ...
pnpm missing                    # All critical fields
pnpm missing:mb                 # Musicbrainz Critical Fields
pnpm missing:mb:artist 			# `MusicBrainz Artist Id` or `MUSICBRAINZ_ARTISTID`
pnpm missing:mb:track 			# `MusicBrainz Release Track Id` or `MUSICBRAINZ_TRACKID`
pnpm missing:mb:album 			# `MusicBrainz Album Id` or `MUSICBRAINZ_ALBUMID`
pnpm missing:mb:album-artist 	# `MusicBrainz Album Artist Id` or `MUSICBRAINZ_ALBUMARTISTID`
pnpm missing:artist			 	# `Artist`
pnpm missing:title			 	# `Title`
pnpm missing:year			 	# `Year`
pnpm missing:genre			 	# `Genre`
pnpm missing:songkong		 	# `SONGKONG_ID`
pnpm missing:acoustid		 	# `ACOUSTID_FINGERPRINT`
pnpm missing:bandcamp		 	# `URL_BANDCAMP_ARTIST_SITE`
pnpm missing:discogs		 	# `URL_DISCOGS_ARTIST_SITE` or `URL_DISCOGS_RELEASE_SITE`
```

An additional argument can be sent to specify the CSV delimiter as semicolon:

```bash
pnpm missing:mb --semi   # Sets the delimiter to `;` instead of `,`
```