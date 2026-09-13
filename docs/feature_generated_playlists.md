# Generated Playlists

Auto-generated playlists — by genre proximity (`GENRE`) and by artist country (`REGION`). Their
seeds (`PlaylistGenerator` rows) live in the database, editable at `/playlists/setup/generated`;
populated into `Playlist` records by the `./playlists` script.

## How It Works

1. `/playlists/setup/generated` manages `PlaylistGenerator` rows: each has a `type` (GENRE/REGION),
   `name`, and `terms` (one match rule per line — see below)
2. The `./playlists` script matches DB genres (GENRE) or artist countries (REGION) against every
   generator's terms
3. Artists are scored by how closely their genres match a GENRE generator (REGION: uniform)
4. Top 500 tracks per generator are selected, max 3 per release
5. Playlists are stored as `Playlist` records with `type = GENRE` or `type = REGION`, linked to the
   generator that produced them

For full details on the script, matching algorithm, and flags, see
[docs/scripts/playlists.md](scripts/playlists.md).

## Data Model

```
PlaylistGenerator          Playlist
  id                  <──── generatorId (unique, onDelete: Cascade)
  type (GENRE|REGION)       type (MANUAL|GENRE|REGION)
  name, slug, description   name, slug, description
  terms String[]            tracks: PlaylistTrack[]
```

| Field | Type | Purpose |
|-------|------|---------|
| `Playlist.type` | `PlaylistType` enum (`MANUAL` \| `GENRE` \| `REGION`) | Distinguishes user-created from generated |
| `Playlist.generatorId` | `String?` (unique) | Links a generated playlist to the `PlaylistGenerator` that produced it |
| `PlaylistGenerator.terms` | `String[]` | Raw textarea lines — see Term Syntax below |

Deleting a `PlaylistGenerator` cascades to its linked `Playlist` (and that playlist's tracks)
immediately — there is no orphaned-playlist cleanup step, the FK does it. Renaming a generator
changes its slug, which the next `./playlists` run reflects (`Playlist.slug`/`name` are refreshed
from the generator on every regenerate — the row itself, and its `generatorId`, are stable).

## Term Syntax

One line per term in the setup UI's textarea:

- **GENRE**: a plain line is a keyword — a library genre matches it exactly (weight 1.0) or as a
  whole word (weight 0.8, e.g. "rock" catches "hard rock"). A line starting with `-` excludes an
  exact genre name (e.g. `-indie rock`), checked first.
- **REGION**: each line is an ISO 3166-1 alpha-2 country code (e.g. `JP`), matched against
  `Artist.country`.

At least one non-`-` line is required for GENRE; REGION requires at least one valid code. Both are
enforced client-side (`helpers/playlistGenerators.ts`'s `validateGenerator`) and server-side (same
helper, re-validated on every write since a client could bypass the form).

## API Behaviour

- `GET /api/playlists` and `GET /api/playlists/[slug]` — return `type` (no more `genreGroup`/`regionGroup`)
- `POST /api/playlists/[slug]/tracks` — returns **403** for any non-`MANUAL` playlist (`GENRE`, `REGION`)
- `DELETE /api/playlists/[slug]/tracks/[trackId]` — same 403 guard
- `DELETE /api/playlists/[slug]` — allowed (script recreates on next run, as long as its generator still exists)
- `/api/playlist-generators/*` (ADMIN only) — CRUD for `PlaylistGenerator`:
  - `GET /api/playlist-generators` — list, each row includes its linked playlist's `trackCount`/`generatedAt`
  - `GET /api/playlist-generators/[id]`
  - `POST /api/playlist-generators` — `{ type, name, description?, terms }`; 400 on invalid input, 409 on slug clash
  - `PUT /api/playlist-generators/[id]` — `{ name, description?, terms }` (type is fixed after creation)
  - `DELETE /api/playlist-generators/[id]` — cascades to the linked `Playlist`

## UI

### `/playlists` page

- **Your Playlists** section first (manual, with "New Playlist" button)
- **Genre Playlists** / **Region Playlists** sections below (sparkle/globe icon + "Auto-generated" label)
- Generated playlist cards have an animated golden gradient border
- A cog icon (admin only, top right) links to `/playlists/setup/generated`

### `/playlists/setup/generated` (admin only)

A data table (pattern: `/downloads/monitoring`) of every `PlaylistGenerator`: name (links to edit),
type badge, terms preview, track count, last generated date, edit/regenerate/remove actions. Top
right: "Add" (new generator) and "Generate playlists" / "Regenerate playlists" (labelled by
whether any generator has produced a playlist yet, runs `./playlists` for every generator). The
per-row Regenerate action instead runs `./playlists --group <slug>`, scoped to just that
generator's playlist — use it to pick up an edited generator without waiting on a full run.

- `/playlists/setup/generated/new` — create form (type select, name, description, terms textarea)
- `/playlists/setup/generated/[id]` — edit form (type fixed, shown as a badge)

### `/playlists/[slug]` detail page

For generated playlists:
- "Auto-generated" badge next to the playlist name
- No delete button, no track remove buttons
- Animated golden border on the cover mosaic
- Its own Regenerate button (same `./playlists` run, not scoped to one generator)

## Components

| Component | Purpose |
|-----------|---------|
| `playlist/Block.vue` | One card for every playlist; applies the animated `genre-border` when `type !== 'MANUAL'` |
| `playlist/BlockImageMosaic.vue` | Cover art mosaic (2x2 grid from the first 4 tracks) |
| `playlist/ButtonGeneratePlaylists.vue` | Triggers a `./playlists` run; label/icon toggle on `regenerate` |
| `playlist/GeneratedPopover.vue` | Explains generated playlists on `/playlists` and the detail page |
| `playlist/GeneratorTable.vue` | The `/playlists/setup/generated` data table |
| `playlist/GeneratorForm.vue` | Create/edit form shared by `new.vue` and `[id].vue` |

Pure parsing/validation for the form lives in `helpers/playlistGenerators.ts` (`parseTerms`,
`termsToText`, `validateGenerator`) — unit tested in `test/helpers/playlistGenerators.test.ts`.
