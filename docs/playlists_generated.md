# Generated Genre Playlists

Auto-generated playlists that group tracks by genre proximity. Populated by a Rust script, read-only in the UI.

## How It Works

1. The `./update-genre-playlists` script matches DB genres to genre groups using keyword matching + configurable includes/excludes
2. Artists are scored by how closely their genres match each group
3. Top 500 tracks per group are selected (max 3 per release for variety)
4. Playlists are stored as `Playlist` records with `type = GENRE`

For full details on the script, matching algorithm, and config format, see [docs/scripts/update-genre-playlists.md](scripts/update-genre-playlists.md).

## Data Model

Two fields added to the `Playlist` model:

| Field | Type | Purpose |
|-------|------|---------|
| `type` | `PlaylistType` enum (`MANUAL` \| `GENRE`) | Distinguishes user-created from generated |
| `genreGroup` | `String?` (unique) | Links playlist to its config group slug (e.g., `"rock"`) |

## API Behaviour

- `GET /api/playlists` and `GET /api/playlists/[slug]` — return `type` and `genreGroup` fields
- `POST /api/playlists/[slug]/tracks` — returns **403** for `GENRE` playlists
- `DELETE /api/playlists/[slug]/tracks/[trackId]` — returns **403** for `GENRE` playlists
- `DELETE /api/playlists/[slug]` — allowed (script recreates on next run)

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
| `playlist/PlaylistBlock.vue` | Card for manual playlists |
| `playlist/PlaylistBlockGenerated.vue` | Card with golden gradient border for genre playlists |
| `playlist/PlaylistCoverMosaic.vue` | Shared cover art mosaic (2x2 grid from first 4 tracks) |

## Config

Genre groups are defined in `scripts/genre-playlists/genre-groups.json`. Each group has:

- `roots` — keywords for automatic matching (e.g., `["rock"]` catches "classic rock", "hard rock", etc.)
- `includes` — genres that don't contain the keyword but belong (e.g., "grunge" in rock)
- `excludes` — genres that match the keyword but shouldn't be included

Run `./update-genre-playlists --report` to see all genre assignments and unmatched genres.

## Current Groups

Rock, Metal, Post-Rock, Indie, Pop, Electronic, Classical, Acoustic, Minimal, Prog, Dance, Hip-Hop, Jazz, Soul & R&B, Punk.
