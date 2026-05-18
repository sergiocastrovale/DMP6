# Scripts: index

Walks MUSIC_DIR, extracts metadata from audio files, and upserts the local DB tree. Sets `lastIndexedAt` on each processed artist, which triggers `sync` to re-sync on the next run.

## Build

```bash
cd scripts && cargo build --release -p index
```

## Usage

```bash
./index                          # Index all artists
./index --only="radiohead"       # Only folders matching prefix
./index --only="radiohead;bjork" # Multiple artists
./index --from="A" --to="M"      # Letter range
./index --overwrite              # Force re-index (ignore change detection)
./index --quick                  # Skip unchanged folders (mtime check)
./index --resume                 # Continue from last checkpoint
./index --skip-covers            # Skip cover art extraction
./index --threads 4              # Rayon thread count (default 8)
./index --web                    # Emit PROGRESS:{json} for the web terminal
```

## Output modes

Without `--web`, the script prints colored, indented progress (folder headers, `→` steps, `✓` success marks). With `--web`, it emits `PROGRESS:{json}` lines consumed by the web UI progress bar, plus plain text for the terminal panel. The web UI appends `--web` automatically when invoking scripts.

## Per-Folder Flow

1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata in parallel (rayon + lofty), including 3 MusicBrainz tags: `MUSICBRAINZ_ALBUMID` (release), `MUSICBRAINZ_RELEASEGROUPID` (release group), `MUSICBRAINZ_ALBUMARTISTID`
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Split** album artist and track artist tags into individual artists
5. **Upsert** Artist, LocalRelease, LocalReleaseTrack, LocalReleaseArtist, TrackRelatedArtist (batch UNNEST)
6. **Cover art** — extract from embedded tags or folder.jpg, upload to S3 if configured
7. **Update totals** for this artist's releases and tracks
8. **Set `lastIndexedAt`** on Artist
9. **Upsert FolderScan** — stores folder mtime for `--quick` mode

## Release Grouping

Releases are deduplicated by `groupKey` (3-tier):
- With MB release ID: `"mbr:{mbReleaseId}:{folderPath}"` (edition-specific)
- With MB release group ID: `"mb:{mbReleaseGroupId}:{folderPath}"`
- Without MB IDs: `"meta:{slugTitle}:{year}:{slugArtist}:{folderPath}"`

The `folderPath` is always part of the key, so the same album in two folders (e.g. original + compilation) creates separate `LocalRelease` rows. This is intentional — index treats each folder as a distinct physical copy. Deduplication into a single release card happens later in **sync**, which links multiple `LocalRelease` rows to the same `MusicBrainzRelease` via `releaseId`. The web UI then groups by MB release, collapsing duplicates.

Before sync runs, every `LocalRelease` appears as its own unmatched card.

## Artist Tag Splitting

`split_artists()` in `common/src/artists.rs`:
- Splits on `feat.`/`ft.`/`featuring` → featured artists
- Splits on `//` `\\` `||` `;` `|` — unambiguous separators
- Splits on ` / ` ` \ ` (space-surrounded only — preserves AC/DC)
- Splits on `vs.`/`vs`
- Does **not** split on `,` (preserves "10,000 Maniacs")
- Does **not** split on `&` (preserves "Simon & Garfunkel")

## Artist Roles (Main vs Related)

Derived entirely from file metadata during indexing:

- **Main artist** = appears in `albumArtist` tag → `Artist.relatedOnly = false`, linked via `LocalReleaseArtist`
- **Related artist** = appears in `artist` tag but NOT in `albumArtist` → `Artist.relatedOnly = true`, linked via `TrackRelatedArtist`

Example: albumArtist="Daft Punk", artist="Daft Punk feat. Pharrell Williams, Nile Rodgers"
- Daft Punk = main artist (owns release, gets browse page, gets MB sync)
- Pharrell Williams, Nile Rodgers = related (displayed as "with Pharrell Williams, Nile Rodgers" below track title)

If a related artist later appears as albumArtist on another release, `relatedOnly` flips to `false` and they get their own page.

No MusicBrainz guessing, no fuzzy matching — purely tag-derived.

## Running on NAS

```bash
docker exec dmp index --from=e --to=fz
```
