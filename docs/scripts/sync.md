# Scripts: sync

Indexes local audio files and syncs artists against MusicBrainz. Processes the entire flow per artist folder: scan, extract metadata, upsert to DB, extract cover art, update totals, then MusicBrainz sync.

## Build

```bash
cd scripts/sync && cargo build --release
```

## Usage

```bash
./sync                           # Index + sync all artists
./sync /path/to/music            # Override music directory
./sync --overwrite               # Nuke + re-index + re-sync all
./sync --only="radiohead"        # Only folders matching prefix
./sync --only="radiohead;brand x;bjork"  # Multiple artists, processed in given order
./sync --from="A" --to="M"      # Process range
./sync --limit=10                # Limit to first N folders
./sync --resume                  # Continue from last checkpoint
./sync --skip-images             # Skip all image operations
./sync --threads 4               # Limit metadata extraction threads
./sync --verbose                 # Show skipped MB releases
./sync --test                    # Use test artists (see below)
./sync --test --overwrite        # Nuke + re-sync test artists only
```

### Test mode

`--test` overrides `MUSIC_DIR` with `web/dump/test-artists/`, a directory of symlinks to a curated subset of artist folders. Requires running [`./symlink-test-artists`](symlink-test-artists.md) first to create the symlinks. Useful for fast iteration during development.

### --overwrite behaviour

`--overwrite` with a filter (`--only`, `--from`/`--to`) nukes all artists matching the filter **and all artists that share releases with them**. This ensures shared releases (split EPs, compilations) are fully rebuilt — no stale data from co-artists remains. All affected artists' MB data, local releases, and tracks are deleted and rebuilt from scratch. Artist matching uses name comparison (not slug), so `--only="...and oceans"` correctly matches the artist regardless of slug formatting.

## Per-Folder Flow

For each artist folder in MUSIC_DIR:

### Index Phase
1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata in parallel (rayon + lofty), including embedded MusicBrainz IDs
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Split** album artist and track artist tags into individual artists (see [Artist Tag Splitting](#artist-tag-splitting))
5. **Upsert** Artist, LocalRelease (keyed by `groupKey` — see [Release Grouping](#release-grouping)), LocalReleaseTrack, TrackArtist, and LocalReleaseArtist junction records (batch UNNEST)
6. **Cover art** — three-tier resolution (see [Cover Art Resolution](#cover-art-resolution))
7. **Update totals** for this artist's releases and tracks

### MusicBrainz Sync Phase (per artist ID in folder)
8. **Skip** "Various Artists"
9. **Re-match** already-synced artists without API calls (ensures correct release statuses). When two artist names resolve to the same MB ID, the second is merged into the first — releases redirected, duplicate cleaned up.
10. **Search** MusicBrainz using embedded IDs first, then name-based fallback (see [Artist Matching](#artist-matching))
11. **Fetch** artist details: URLs, genres, tags
12. **Download** artist image — see [Artist Image Resolution](#artist-image-resolution). Image resized to 200×200 JPEG.
13. **Fetch** release groups and tracks
14. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
15. **Set match status** per release: `COMPLETE`, `INCOMPLETE`, `EXTRA_TRACKS`, `MISSING`. Release title matching uses `normalize_title()` (punctuation stripped) so "Collateral Damage - Complete War Series" matches "Collateral Damage – Complete War Series".
16. **Cover Art Archive** fallback for releases still missing art after step 6 (see [Cover Art Resolution](#cover-art-resolution))
17. **Save progress** to `Statistics.lastSyncedArtist`

### Validated extra artists (per folder)
After the primary sync loop, artists discovered from MB release credits or compound name splitting are validated and synced:

18. **Check credits** — for each candidate extra artist (from MB's artist-credit array or compound name splitting), check if the artist name appears in the `albumArtist` tag of any track in this folder (case-insensitive substring match on `albumArtist` only — track-level `artist` tags are not checked, to prevent featured credits becoming album-level links)
19. **Discard** candidates with no local albumArtist match — not created, not linked
20. **Full sync** for validated extras — same treatment as primary artists: details, image (external sources only — folder image fallback still applies if name matches), full MB catalogue, match status, averageMatchScore

## Release Grouping

Releases are deduplicated by a `groupKey` column on `LocalRelease`, computed from **metadata** rather than folder structure. This correctly groups multi-disc albums (CD1/, CD2/ subfolders) into a single release.

**Grouping priority:**
1. **MusicBrainz album ID** — when tracks have an embedded `MUSICBRAINZ_ALBUMID` or `MUSICBRAINZ_RELEASEGROUPID` tag, the key is `mb:{id}`. All tracks sharing the same MB release ID belong to one release regardless of folder layout.
2. **Metadata fallback** — when no MB ID is present, the key is `meta:{slug(title)}:{year}:{slug(album_artist)}`. Tracks with the same album title, year, and album artist are grouped together.

**MB ID propagation:** If some tracks in an album have an embedded MB album ID and others don't (but share the same title/year/artist metadata), the MB ID is propagated to all of them so they receive the same `groupKey`.

**Disc subfolder stripping:** Folder paths ending in common disc patterns (`CD1`, `Disc 2`, `Disk3`, etc.) are normalized to the parent directory for the `folderPath` stored on the release.

## Multi-Artist Handling

A release can belong to multiple artists via the `LocalReleaseArtist` junction table. This means:

- **No compound artists**: "Abc vs. XY" is never stored as one artist. Instead, two separate Artist records are created and both are linked to the same release.
- **Shared releases**: If you browse artist "Abc", you see the collaboration release. If you browse "XY", you see the same release (not a copy).
- **Split happens at index time**: Album artist and track artist tags are split by unambiguous separators before any DB writes.

### Credited Artist Discovery

When MusicBrainz returns additional artist credits on a release (e.g. a split EP credits two bands), each credited artist is validated before being added:

1. **MB returns credits**: the release-group's `artist-credit` array lists all credited artists
2. **Validate against local metadata**: does the credited artist's name appear in the `albumArtist` tag of any track in this folder? (case-insensitive substring match on `albumArtist` only — track-level `artist` tags are not used, to prevent featured credits becoming album-level links)
3. **If yes** → create the artist, link the shared release, and sync the full MB catalogue (details, releases, match status, averageMatchScore). Treated identically to any other artist.
4. **If no** → discard. The artist is not created and the release is not linked.

This ensures only artists that actually appear in the local file metadata (as album artist) are added. Random MB credits with no local album-level presence are ignored.

### Compound Name Detection

When a tag like "10cc & Godley & Creme" can't be split at index time (because `&` is ambiguous), it's resolved during sync:

1. MB match returns a different name (e.g. "10cc") with additional credits ("Godley & Creme")
2. `is_likely_compound_of()` detects the mismatch — requires a visible separator (`&` with dissimilar parts, `vs.`, `–`, `//`, `|`, ` x `) in the original name
3. All component artists are queued for validation (step 18 above) and full sync
4. The compound artist record is cleaned up (links removed, deleted by Step 5b cleanup which removes artists with `musicbrainzId IS NULL` and no releases)

### Main vs Related Artists

The distinction is encoded in the database, not the filesystem:

- **Main artist** — has at least one `TrackArtist` row. Written in the index loop (step 5) when a name comes directly from an `albumArtist`, `artist`, or `feat.` tag. The artist *is in the metadata*.
- **Related artist** — has `LocalReleaseArtist` links but **no** `TrackArtist` rows. Created only by the extra-artists/compound-split phase (steps 18–20), where the name surfaced via MB artist-credit disambiguation, never from a raw tag. Added *because* they're associated with a main artist.

`Statistics.mainArtists` / `Statistics.relatedArtists` are computed from exactly this signal:
`EXISTS (SELECT 1 FROM "TrackArtist" WHERE "artistId" = a.id)`.

### Same MB ID = Same Artist

When two different artist names resolve to the same MusicBrainz ID (e.g. "Hävok Ünit" and "Havoc Unit"), the second is always merged into the first: its local releases are redirected to the existing artist record, and the duplicate is cleaned up. MB ID is the identity — name differences are irrelevant.

## Artist Tag Splitting

Multi-artist tags are split into individual Artist + TrackArtist records:

- **Split on**: `//`, `\\`, ` / `, ` \ `, `;`, `|`, `||`, `vs.`/`vs`, `feat.`/`ft.`/`featuring`
- **Not split on**: bare `/` without spaces (ambiguous — "AC/DC"), `&` (ambiguous — "Simon & Garfunkel"), `,` (preserves "Crosby, Stills & Nash", "10,000 Maniacs"). These are resolved at sync time via MB artist-credit lookups (Step 5) or tried as splits only when an anchor artist is already confirmed (Step 6).

| Tag source | Role |
|-----------|------|
| `albumArtist` main artists | `ALBUM_ARTIST` |
| `artist` main artists | `PRIMARY` |
| Featured artists (either tag) | `FEATURED` |

## Artist Matching

Six-step resolution with embedded MusicBrainz IDs taking priority:

1. **Embedded album artist ID** (`MUSICBRAINZ_ALBUMARTISTID`) — direct artist lookup via `/artist/{id}`. This is the source of truth when available.
2. **Embedded album ID** (`MUSICBRAINZ_ALBUMID`) — look up the release group via `/release-group/{id}?inc=artist-credits` to get all artist credits. Searches the credits for the one matching the searched artist name (by similarity or case-insensitive match). If no credit matches the searched name, falls through to Step 3 rather than assigning the wrong artist's MB ID. Returns the matched artist as primary, all others as additional candidates.
3. **Name search** (stored artist name) — quoted phrase search (`artist:"Name"`) with score >= 90 + Jaccard similarity >= 50%. Single-token names require exact match.
4. **Raw artist tag** — if the raw `artist` tag from a sample track differs from the stored name, search that too. Saved as a candidate but does not short-circuit — continues to step 5.
5. **Release-group artist credits** — search MB for a release-group by album title + artist name, then use the structured `artist-credit` array from the result. This resolves compound names without ambiguous string splitting: `"Kool & the Gang"` returns 1 credit entry (one artist), while `"…and Oceans vs. Bloodthorn"` returns 2 (two artists).
6. **Split compound tags** (last resort) — split by unambiguous separators (`/`, `//`, `\`, `\\`, `|`, `||`, `;`, `feat.`, `vs.`, `–`) and search each part. Ambiguous separators (`&`, `,`) are only tried when step 4 already confirmed an anchor artist — this prevents "Kool & the Gang" from being split while correctly resolving "070 Shake & Christine and the Queens".

Steps 1-2 avoid name-based searching entirely when embedded MusicBrainz metadata is present in the audio files. Steps 1-2 also filter out special MB artists (Various Artists, [unknown], etc.) and fall through to name-based search. Steps 4-6 check both `artist` and `albumArtist` tags (via `TrackArtist` and `LocalReleaseArtist` links) to discover compound names regardless of which tag contains them.

## Release Title Matching

Release title comparison uses `normalize_title()` on both the MB title and the local title before comparing. This strips all non-alphanumeric characters (punctuation, dashes, en-dashes, em-dashes) and normalises whitespace, so "Collateral Damage - Complete War Series" correctly matches "Collateral Damage – Complete War Series".

## Artist Image Resolution

Six-tier fallback for artist images, resized to 200×200 JPEG:

1. **Folder image** (single-artist folders only) — `folder.jpg`, `cover.jpg`, or the first jpg/png found in the artist folder root. Only attempted when `folder_artist_ids` has exactly one entry (metadata-driven, never based on folder name), so artists in multi-artist folders don't inherit each other's photo.
2. **MB `image` relation** — direct image link from MusicBrainz URL relations. Wikimedia Commons page URLs (`/wiki/File:...`) are converted to `Special:FilePath` direct image URLs automatically.
3. **Fanart.tv** — artist thumbnail via MB artist ID. Requires `FANART_API_KEY` in `web/.env`; skipped if not set.
4. **Wikidata P18** — image claim from the artist's Wikidata entity (linked via MB's `wikidata` relation).
5. **Wikipedia page image** — thumbnail from the artist's Wikipedia article (linked via MB's `wikipedia` relation). Title is URL-encoded before querying the API.
6. **Folder image fallback** — if all external sources fail and the artist name exactly matches the folder name (case-insensitive), use the folder image. This covers multi-artist folders where the folder is named after one of the artists (e.g. the `...And Oceans` folder contains a split EP, but `...And Oceans` the artist still gets the folder photo).

Artist image files are stored at `web/public/img/artists/{slug}.jpg` (local) and/or `artists/{slug}.jpg` on S3, controlled by `IMAGE_STORAGE`. When `--overwrite` nukes an artist, the image file is deleted from disk so it is cleanly re-downloaded on the next sync.

## Cover Art Resolution

Three-tier fallback for release cover art:

1. **Embedded metadata** — extract cover from the first audio file in the release that has embedded artwork (via lofty). Resized to 200×200 JPEG.
2. **Folder images** — if no embedded art, check the release folder for `cover.jpg` or `folder.jpg`. Resized to 200×200 JPEG.
3. **Cover Art Archive** — after the MB sync phase links releases to release groups, fetch from `coverartarchive.org/release-group/{id}/front`. The downloaded image is also saved as `folder.jpg` in the source folder (so future syncs use tier 2 instead of hitting the API again).

All tiers support both local storage (`web/public/img/releases/`) and S3 upload, controlled by the `IMAGE_STORAGE` env var.

## Resume

- Progress saved to `Statistics.lastSyncedArtist` after each folder completes
- The original `--from` / `--to` / `--only` of a fresh run are persisted to `Statistics.lastSyncArgs` (JSONB) at the start of that run, so a later `--resume` can reconstruct the exact same range with no flags
- `--resume` skips all folders with name <= the saved value
- If stopped mid-folder, resume restarts that folder from scratch
- Restoration is per-flag: `./sync --resume --from=d` overrides only `from`, while `to`/`only` are still inherited from the saved checkpoint
- Both `lastSyncedArtist` and `lastSyncArgs` are cleared on successful completion, and overwritten at the start of any non-resume run

## Rate Limiting

- Starts at 1s between requests
- Doubles delay on 503/429 (up to 10s), reduces by 15% on success (down to 1s)
- Up to 10 retries per request with exponential backoff

## Error Handling

- Errors logged to `errors.log` with `[timestamp][SYNC]` prefix
- Non-fatal; processing continues with next artist/folder
- Failed artists listed in final summary
- "No MusicBrainz match" is a CLI warning only — not logged to errors.log
