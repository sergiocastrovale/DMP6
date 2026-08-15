# Scripts: artist-photos

One-off backfill: for every artist that owns a release (i.e. has an actual artist page — not a
collaborator-only credit, not an artist merged into another via `primaryArtistId`) and currently has
no `Artist.image`/`imageUrl`, fetches a photo and stores it in three places: `{IMAGE_DIR}/artists/{slug}.jpg`
(+ S3, if configured), `{MUSIC_DIR}/{ArtistFolder}/folder.jpg` (only if that folder has no cover of its
own yet), and the `Artist.image`/`imageUrl` DB columns.

## Build

```bash
cd scripts && cargo build --release -p artist-photos
```

## Usage

```bash
./artist-photos                    # Full run over every photo-less artist with a MusicBrainz id
./artist-photos --dry-run          # Look up candidates + report source availability, write nothing
./artist-photos --limit 50         # Cap the run - validate before committing to the full pass
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | false | Fetch MB detail per candidate and report whether a Wikidata/Wikipedia relation or Fanart.tv key is available, but never download an image or write to disk/DB |
| `--limit` | u32 | unbounded | Cap the number of candidates processed |
| `--web` | bool | false | Machine-readable progress output |

## How It Works

1. Query candidates: `Artist` rows with `primaryArtistId IS NULL`, an owned `LocalReleaseArtist`,
   `image`/`imageUrl` both null, and a `musicbrainzId` set (no MB id → no relations to look up → out
   of scope; that's an artist-resolution gap, not an image-fetch one). Each candidate also carries the
   first path segment of one of its releases' `LocalRelease.folderPath` as its on-disk artist folder.
2. Per candidate, sequentially (MusicBrainz is rate-limited to ~1 req/s via `MB_MIN_DELAY_MS`):
   fetch MB artist detail (`url-rels`) to read its Wikidata/Wikipedia relation URLs.
3. Bounded to 4 concurrent (`common::images::download_artist_image`, shared with `sync`): try
   Wikidata → Wikipedia → Fanart.tv (first hit wins), resize to fit 500px, write
   `{IMAGE_DIR}/artists/{slug}.jpg`, upload to S3 if configured, copy into
   `{MUSIC_DIR}/{ArtistFolder}/folder.jpg` unless a `folder.jpg`/`cover.jpg` is already there, then
   record the result on the `Artist` row (`common::images::record_artist_image`).

This is the same source chain `sync` already runs mid-sync for any artist still missing a photo —
this script just retries it standalone, once, for every currently photo-less resolvable artist,
without re-syncing the whole library.

## Why These Artists Still Lack A Photo

`sync` only attempts an image fetch for artists actively being (re)synced, once, best-effort: no MB id
→ never attempted; all three sources miss → recorded as not-found, never retried. Most of the library
was synced before this catches up, so a large backlog of "tried once, came up empty (or was never
tried)" artists accumulates. This script clears that backlog in one pass.

## Summary Output

| Line | Meaning |
|---|---|
| `Candidates` | Artists matching the query above |
| `Downloaded` | Image fetched and stored (implies DB + `IMAGE_DIR` write; `MUSIC_DIR` write only if the artist folder was known and had no cover yet) |
| `Not found` | None of Wikidata/Wikipedia/Fanart.tv had an image, or the download failed |
| `MB detail error(s)` | The MusicBrainz artist-detail lookup itself failed (network/API error, not "no image") |

## After Running

Re-run an `Artist` photo-count query to confirm the drop in photo-less artists. Artists still missing
one after a full run either have no MB id (resolve those via `./index --resolve-artists` first) or
genuinely have no photo on any of the three sources.

The music library is not mounted locally - a real run (the one that writes `folder.jpg`) happens on
the NAS, so `./deploy` first. Local runs still update `IMAGE_DIR`/S3/DB — only the on-disk
`MUSIC_DIR` copy is a no-op locally.
