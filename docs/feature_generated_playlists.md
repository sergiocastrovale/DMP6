# Generated Playlists

Auto-generated playlists — by genre proximity (`GENRE`) and by artist country (`REGION`). Populated by
the `./playlists` script, read-only in the UI.

## How It Works

1. The `./playlists` script matches DB genres to genre groups using keyword matching + configurable includes/excludes
2. Artists are scored by how closely their genres match each group
3. Top `max_tracks` (500 in the shipped config) per group are selected, max `max_per_release` (3) per release
4. Playlists are stored as `Playlist` records with `type = GENRE` or `type = REGION`

For full details on the script, matching algorithm, and config format, see [docs/scripts/playlists.md](scripts/playlists.md).

## Data Model

Two fields added to the `Playlist` model:

| Field | Type | Purpose |
|-------|------|---------|
| `type` | `PlaylistType` enum (`MANUAL` \| `GENRE` \| `REGION`) | Distinguishes user-created from generated |
| `genreGroup` | `String?` (unique) | Links playlist to its config group slug (e.g., `"rock"`) |

## API Behaviour

- `GET /api/playlists` and `GET /api/playlists/[slug]` - return `type` and `genreGroup` fields
- `POST /api/playlists/[slug]/tracks` - returns **403** for any non-`MANUAL` playlist (`GENRE`, `REGION`)
- `DELETE /api/playlists/[slug]/tracks/[trackId]` - same 403 guard
- `DELETE /api/playlists/[slug]` - allowed (script recreates on next run)

## UI

### `/playlists` page

- **Your Playlists** section first (manual, with "New Playlist" button)
- **Genre Playlists** section below (with sparkle icon + "Auto-generated" label)
- Genre playlist cards have an animated golden gradient border

### `/playlists/[slug]` detail page

For genre playlists:
- "Auto-generated" badge next to the playlist name
- No delete button
- No track remove buttons
- Animated golden border on the cover mosaic

## Components

| Component | Purpose |
|-----------|---------|
| `playlist/Block.vue` | One card for every playlist; applies the animated `genre-border` when `type !== 'MANUAL'` |
| `playlist/BlockImageMosaic.vue` | Cover art mosaic (2x2 grid from the first 4 tracks) |
| `playlist/GenerateButton.vue`, `RegenerateButton.vue`, `GeneratedPopover.vue` | Trigger and explain a `./playlists` run from the UI |

## Config

Genre groups are defined in `scripts/playlists/genre-groups.json`. Each group has:

- `roots` - keywords for automatic matching (e.g., `["rock"]` catches "classic rock", "hard rock", etc.)
- `includes` - genres that don't contain the keyword but belong (e.g., "grunge" in rock)
- `excludes` - genres that match the keyword but shouldn't be included

Run `./playlists --report` to see all genre assignments and unmatched genres.

## Current Groups

Rock, Metal, Post-Rock, Indie, Pop, Electronic, Classical, Acoustic, Minimal, Prog, Dance, Hip-Hop, Jazz, Soul & R&B, Punk.
