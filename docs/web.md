# Web UI Specification

This document is the single source of truth for the DMP v6 web application.

## Stack

- **Framework**: Nuxt 4.x (latest) + Vue 3 + TypeScript
- **Styling**: Tailwind CSS v4 only (absolutely no custom CSS)
- **Icons**: Lucide (`lucide-vue-next`)
- **State**: Pinia with localStorage persistence (`pinia-plugin-persistedstate`)
- **Database**: Prisma + PostgreSQL (schema at `web/prisma/schema.prisma`)
- **Audio**: HTML5 Audio API, streamed from `MUSIC_DIR` (server and files on same machine)
- **Images**: Configurable via `IMAGE_STORAGE` env. Prefer S3 `imageUrl` when available, fall back to local `image` field
- **Utilities**: `@vueuse/core`, `date-fns`

## Coding Standards

- All TypeScript definitions live in `web/types/`
- API consolidated with centralized patterns in `server/api/`
- Zero CSS - Tailwind utility classes only
- Icons from Lucide only
- Keep database queries performant - use Prisma `select` to limit fields, proper indexes
- No scripts-related code, no downloader code, no CLI invocation code

## Design

### Theme

Dark mode only (no light mode toggle).

**Color palette:**

| Token | Value | Tailwind |
|-------|-------|----------|
| Background | `#09090b` | zinc-950 |
| Surface | `#18181b` | zinc-900 |
| Surface elevated | `#27272a` | zinc-800 |
| Border | `#3f3f46` | zinc-700 |
| Text primary | `#fafafa` | zinc-50 |
| Text secondary | `#a1a1aa` | zinc-400 |
| Accent | `#f59e0b` | amber-500 |
| Accent hover | `#d97706` | amber-600 |

### Layout

```
+--sidebar--+--main-container-----------------------------+
| Logo      | [Search bar (omnipresent)]                  |
| Home      | +--page-content----------------------------+ |
| Browse    | |                                          | |
| Timeline  | |                                          | |
| Playlists | |                                          | |
| Favorites | |                                          | |
|           | +------------------------------------------+ |
| [Stats]   | [Player bar (fixed bottom)]                 |
+-----------+---------------------------------------------+
```

**Sidebar** (left, fixed width ~64px collapsed / ~220px expanded):
- Logo at top
- Navigation links: Home, Browse, Timeline, Playlists, Favorites
- Statistics icon pinned to bottom
- Active link highlighted with amber accent
- On mobile: collapses to hamburger menu

**Search bar** (top of main container, omnipresent on all pages):
- Full-width input with search icon
- Dropdown overlay with grouped results: Artists, Releases, Tracks
- Queries all 3 tables in parallel (Artist by name, LocalRelease by title, LocalReleaseTrack by title)
- Max 5 results per category in dropdown
- Click result to navigate (artist page, or play track/release)

**Player bar** (fixed bottom, full width, persists across all pages):
- Spotify-style layout: track info (left) | controls + progress (center) | volume + extras (right)
- Persists across page navigation
- State saved to localStorage (volume, queue, current track, position, shuffle mode)

**Mobile** (responsive):
- Sidebar collapses to bottom tab bar or hamburger
- Player bar stays fixed at bottom
- Search accessible via icon tap

## Pages

### `/` - Home

Spotify-like dashboard with sections, each showing a grid of release covers:

1. **Latest additions** - Most recently indexed releases (max 50, no pagination). "View more" links to a dedicated grid page.
2. **Recent plays** - Most recently played releases (max 50, no pagination). "View more" links to a dedicated grid page.
3. **Your playlists** - Cover art grid (Spotify-style mosaic of track covers). "View more" links to `/playlists`.
4. **Your favorites** - Favorite releases grid. "View more" links to `/favorites`.

Each section: horizontal scrollable row or responsive grid of cover art cards.

### `/browse` - Artist Grid

Same look and feel as v5 `pages/index.vue`:

- Grid of artist cards (image, name, match score pill)
- Infinite scroll (load more at 75% scroll)
- Filters:
  - **Letter filter**: A-Z buttons to filter by first letter
  - **Genre filter**: multi-select genre tags
  - **Match score filter**: range slider (0-100%)
  - **Sort**: alphabetical, play count, match score, recently added
  - **Search**: text input to filter artists by name (within browse context)
- Advanced filters panel (collapsible)

### `/artist/[slug]` - Artist Detail

Unified view merging MusicBrainz releases with local releases:

- **Header**: Artist image, name, genres (pills), external URLs, match score
- **Tabs**: One tab per release type (Album, EP, Compilation, Live, etc.)
- **Release cards** within each tab:
  - Cover art, title, year
  - Status badge: COMPLETE (green), INCOMPLETE (yellow), MISSING (red), EXTRA_TRACKS (blue), UNSYNCABLE (gray), UNKNOWN (gray)
  - For INCOMPLETE: show "X of Y tracks" count
  - Play button on hover (loads all release tracks into queue)
- **Tracks table** (expandable per release or shown when release is clicked):
  - Track number, title, duration, play button
  - Favorite toggle per track

### `/timeline` - Timeline

Same structure as v5:

- **Layout**: uses a dedicated timeline layout
- **Decade tabs**: 1950s, 1960s, ..., 2020s
- **Year sub-navigation**: within a decade, filter by specific year
- **Release grid**: covers sorted chronologically with year separators
- **Infinite scroll** with batch loading (50 per batch)

### `/favorites` - Favorites

- Filter tabs: All / Releases / Tracks
- Grid/list of favorited items
- Each item shows cover, title, artist, play button, unfavorite button
- Sorted by date added (newest first)

### `/playlists` - Playlists List

- Grid of playlist cards with cover art mosaic (Spotify-style 4-cover grid)
- Create playlist button (opens dialog)
- Each card: playlist name, track count, click to open

### `/playlists/[slug]` - Playlist Detail

- Header with playlist name, track count, total duration
- Play All button
- Track table: position, title, artist, album, duration, remove button
- Drag to reorder (stretch goal)

### `/statistics` - Statistics

- Display all fields from the `Statistics` table in a nice grouped layout
- Groups: General (artists, tracks, releases, genres), Playback (plays, playtime), Sync (artists synced, releases synced), Cover Art (artists with art, releases with art)
- Formatted values (playtime as hours/days, large numbers with separators)
- Statistics icon in sidebar bottom links here

## Audio Player

### Core Features

- Play/pause, next/previous
- Seek (click and drag on progress bar)
- Volume control (slider + mute toggle)
- Queue management (set queue, add to queue)
- Track info display (title, artist, cover art)
- Time display (current / total)

### Shuffle Mode (Cycle Button)

Single button that cycles through 4 modes:

1. **Off** - Sequential playback through queue
2. **Release shuffle** - Shuffle tracks within the current release only
3. **Artist shuffle** - Shuffle any track from the current artist
4. **Catalogue shuffle** - Random track from entire catalogue (API call to `/api/tracks/random`)

Visual indicator: icon changes or badge shows current mode.

### Favorites Integration

- Heart icon on current track in player bar
- Toggle adds/removes from FavoriteTrack table

### Playlist Integration

- "Add to playlist" button/menu on current track
- Dropdown showing existing playlists + "Create new"

### State Persistence

Saved to localStorage (debounced):
- Current track ID
- Current position (seconds)
- Volume level
- Mute state
- Queue (track IDs)
- Shuffle mode
- Play state (paused, not auto-playing on reload)

On page load: restore state, load track metadata, seek to saved position, but do NOT auto-play.

## API Routes

All routes use shared Prisma client from `server/utils/prisma.ts`.

### Artists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/artists` | List artists (paginated, filterable by letter/genre/score/sort) |
| GET | `/api/artists/[slug]` | Artist detail with releases, genres, URLs |
| GET | `/api/artists/[slug]/tracks` | All tracks for an artist |

### Releases

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/releases/[id]/tracks` | Tracks for a specific release |
| GET | `/api/releases/latest` | Latest indexed releases (limit 50) |
| GET | `/api/releases/last-played` | Recently played releases (limit 50) |

### Tracks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tracks/random` | Random track (for catalogue shuffle) |
| POST | `/api/tracks/[id]/play` | Increment play count, update lastPlayedAt |

### Audio

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audio/[id]` | Stream audio file (supports Range headers for seeking) |

### Favorites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/favorites` | Get all favorites (releases + tracks) |
| POST | `/api/favorites/releases/[id]` | Favorite a release |
| DELETE | `/api/favorites/releases/[id]` | Unfavorite a release |
| POST | `/api/favorites/tracks/[id]` | Favorite a track |
| DELETE | `/api/favorites/tracks/[id]` | Unfavorite a track |

### Playlists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/playlists` | List all playlists |
| POST | `/api/playlists` | Create playlist |
| GET | `/api/playlists/[slug]` | Playlist detail with tracks |
| DELETE | `/api/playlists/[slug]` | Delete playlist |
| POST | `/api/playlists/[slug]/tracks` | Add track to playlist |
| DELETE | `/api/playlists/[slug]/tracks/[trackId]` | Remove track |

### Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=` | Search artists, releases, tracks (returns grouped results, max 5 per category) |

### Timeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/timeline/decades` | Get available decades with counts |
| GET | `/api/timeline/[decade]` | Get releases for a decade (paginated) |

### Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Get statistics record |

## Image Resolution

For any entity with both `image` (local filename) and `imageUrl` (S3 URL):

1. If `IMAGE_STORAGE` includes `s3` and `imageUrl` is set: use `imageUrl`
2. Else if `image` is set: use `/img/{type}/{image}` (served from `web/public/img/`)
3. Else: show placeholder

The API should return both fields; the frontend resolves which to display using a composable (`useImageUrl`).

## File Structure

```
web/
  nuxt.config.ts
  tailwind.config.ts
  app.vue
  types/
    artist.ts
    release.ts
    track.ts
    player.ts
    playlist.ts
    favorites.ts
    search.ts
    stats.ts
    api.ts
  layouts/
    default.vue         # Sidebar + search bar + player bar
    timeline.vue        # Timeline-specific with decade/year nav
  pages/
    index.vue           # Home (latest, recent, playlists, favorites)
    browse.vue          # Artist grid with filters
    artist/[slug].vue   # Artist detail
    timeline/[[decade]]s/index.vue
    timeline/[[decade]]s/[year].vue
    favorites.vue
    playlists/index.vue
    playlists/[slug].vue
    statistics.vue
  components/
    layout/
      Sidebar.vue
      SearchBar.vue
      SearchDropdown.vue
      Logo.vue
      MobileNav.vue
    player/
      AudioPlayer.vue
      PlayerControls.vue
      ProgressBar.vue
      VolumeControl.vue
      ShuffleMode.vue
      TrackInfo.vue
    artist/
      ArtistHeader.vue
      ArtistReleases.vue
      ArtistGenres.vue
      ArtistUrls.vue
      ScorePill.vue
    browse/
      ArtistGrid.vue
      ArtistCard.vue
      FilterLetter.vue
      FilterGenre.vue
      FilterScore.vue
      FilterSort.vue
    home/
      SectionLatest.vue
      SectionRecentPlays.vue
      SectionPlaylists.vue
      SectionFavorites.vue
      ReleaseCard.vue
    release/
      ReleaseCover.vue
      StatusBadge.vue
      TracksTable.vue
      TrackRow.vue
    playlist/
      PlaylistCard.vue
      PlaylistTrackRow.vue
      PlaylistDialog.vue
    timeline/
      DecadeTabs.vue
      YearNav.vue
    search/
      SearchResults.vue
    ui/
      Dialog.vue
      Loading.vue
      Pill.vue
      Skeleton.vue
  composables/
    useAudio.ts         # HTML5 Audio wrapper (load, play, pause, seek, volume)
    usePlayer.ts        # Player state logic (queue, next/prev, shuffle)
    useFavorites.ts     # Favorites state and API calls
    useSearch.ts        # Search debounce and API calls
    useImageUrl.ts      # Resolve image URL (S3 vs local)
  stores/
    player.ts           # Player state (Pinia, persisted)
    browse.ts           # Browse filters and pagination
    artist.ts           # Artist detail state
  server/
    api/
      audio/[id].get.ts
      artists/index.get.ts
      artists/[slug].get.ts
      artists/[slug]/tracks.get.ts
      releases/[id]/tracks.get.ts
      releases/latest.get.ts
      releases/last-played.get.ts
      tracks/random.get.ts
      tracks/[id]/play.post.ts
      favorites/index.get.ts
      favorites/releases/[id].post.ts
      favorites/releases/[id].delete.ts
      favorites/tracks/[id].post.ts
      favorites/tracks/[id].delete.ts
      playlists/index.get.ts
      playlists/index.post.ts
      playlists/[slug].get.ts
      playlists/[slug].delete.ts
      playlists/[slug]/tracks.post.ts
      playlists/[slug]/tracks/[trackId].delete.ts
      search.get.ts
      timeline/decades.get.ts
      timeline/[decade].get.ts
      stats.get.ts
    utils/
      prisma.ts         # Shared PrismaClient singleton
  prisma/               # Already exists
  public/
    img/                # Already exists (artists/, releases/)
```

## Things We Do NOT Implement

- Genres page
- Galaxy visualizer / 3D explore
- Settings page
- Downloader UI
- Soulseek UI
- Authentication (planned for future, see `docs/auth_proposal.md`)
- Any script invocation from the web UI

---

## Implementation Phases

### Phase 1 - Foundation and Core

**Goal**: Project scaffolding, layout, browse page, artist page, audio player, core APIs.

1. Initialize Nuxt 4 project with all dependencies
2. Configure Tailwind (dark-only, zinc + amber palette)
3. Set up Prisma client in `server/utils/prisma.ts`
4. Create TypeScript types in `types/`
5. Build default layout: sidebar, search bar (placeholder), player bar (shell)
6. Build `/browse` page: artist grid, infinite scroll, letter/genre/score/sort filters
7. Build `/artist/[slug]` page: unified MB + local releases, type tabs, status badges, tracks table
8. Build audio player: play/pause, seek, volume, queue, next/prev
9. Build `/api/audio/[id]` streaming endpoint with Range header support
10. Build core API routes: artists (list, detail, tracks), releases (tracks), tracks (random, play count)

### Phase 2 - Home, Search, Favorites, Playlists

**Goal**: Home page, search dropdown, favorites, playlists, shuffle modes.

1. Build `/` home page: latest additions grid, recent plays, playlists, favorites, each with "view more"
2. Build search dropdown: omnipresent in search bar, queries artists/releases/tracks, grouped results
3. Build favorites system: toggle on tracks/releases, `/favorites` page with filter tabs
4. Build playlists: CRUD, cover mosaic grid, `/playlists` and `/playlists/[slug]`
5. Build shuffle cycle button: Off -> Release -> Artist -> Catalogue
6. Integrate playlists into player (add/remove tracks from current track)
7. Build all supporting API routes: search, favorites CRUD, playlists CRUD, latest/last-played releases

### Phase 3 - Timeline, Statistics, Polish

**Goal**: Remaining pages, mobile polish, performance.

1. Build `/timeline` with decade tabs, year sub-navigation, release cover grids, batch loading
2. Build `/statistics` page with grouped stats display
3. Build timeline layout with decade/year navigation
4. Build all supporting API routes: timeline decades, decade detail, stats
5. Mobile responsive refinements (sidebar collapse, touch-friendly player)
6. Performance: API response caching, lazy-loaded images, loading skeletons, empty states
7. Error handling: 404 pages, API error boundaries, graceful degradation
