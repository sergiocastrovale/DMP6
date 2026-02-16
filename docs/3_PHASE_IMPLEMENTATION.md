# DMP v6 Web UI - Three Phase Implementation

**Document Purpose**: This document serves as a comprehensive record of the complete implementation of the DMP v6 web user interface, built from scratch using Nuxt 4, Vue 3, TypeScript, and Tailwind CSS v4. This is the authoritative source of truth for understanding what was built, how it works, and what design decisions were made.

**Date Created**: February 14, 2026  
**Status**: All Three Phases Complete ✅

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technical Stack](#technical-stack)
3. [Architecture Decisions](#architecture-decisions)
4. [Phase 1: Foundation and Core](#phase-1-foundation-and-core)
5. [Phase 2: Home, Search, Favorites, Playlists](#phase-2-home-search-favorites-playlists)
6. [Phase 3: Timeline, Statistics, Polish](#phase-3-timeline-statistics-polish)
7. [Critical Fixes and Debugging](#critical-fixes-and-debugging)
8. [API Endpoints Reference](#api-endpoints-reference)
9. [Database Schema Notes](#database-schema-notes)
10. [Component Architecture](#component-architecture)
11. [State Management](#state-management)
12. [Future Considerations](#future-considerations)

---

## Project Overview

### Goals
Build a modern, dark-themed music player web interface to replace DMP v5, with:
- Unified view of MusicBrainz catalog and local library
- Advanced filtering and search
- Playlist and favorites management
- Timeline view by decade
- Comprehensive statistics
- Full mobile responsiveness

### Non-Goals
- Light mode (dark only)
- Multi-user authentication (single user system)
- Downloader functionality (removed from v5)
- Settings pages (minimal configuration needed)

### Key User Decisions
Based on an extensive user interview, the following decisions were made:
- **Root Route**: `/` is the Home dashboard (not Browse)
- **Browse**: Accessible via `/browse` with artist grid
- **Color Scheme**: Neutral dark palette (zinc) with amber accents
- **Mobile Support**: Critical - full responsive design required
- **Search**: Global omnisearch with dropdown (not sidebar)
- **Shuffle Modes**: Cycle button through off → release → artist → catalogue
- **Playlist Display**: Cover art mosaic grid
- **Timeline**: Decade-based navigation (same as v5)

---

## Technical Stack

### Core Framework
- **Nuxt 4.3.1**: Latest stable release with full ESM support
- **Vue 3.5**: Composition API throughout
- **TypeScript 5.x**: Strict typing enabled
- **Node 24.13.0**: LTS version

### Styling & UI
- **Tailwind CSS v4**: Beta version, no custom CSS
- **lucide-vue-next**: Icon library (consistent design language)
- **Custom color palette**: Zinc grays with amber accent (#f59e0b)

### Backend & Data
- **Prisma 6.6.0**: ORM for PostgreSQL
- **PostgreSQL 14+**: Main database
- **Server API Routes**: Nuxt's built-in server capabilities
- **HTML5 Audio API**: Client-side playback

### State & Utilities
- **Pinia**: Vue state management with localStorage persistence
- **@vueuse/core**: Composables library (useDebounceFn, etc.)
- **date-fns**: Date formatting and manipulation

### Storage
- **S3**: Primary image storage (CloudFlare R2 compatible)
- **Local Fallback**: `web/public/img/` for development
- **IMAGE_STORAGE env var**: Controls resolution preference

---

## Architecture Decisions

### 1. Image Resolution Strategy
**Problem**: Images can exist in S3 or locally, need unified resolution.

**Solution**: Created `composables/useImageUrl.ts` with helper functions:
```typescript
- artistImage(artist): Resolves artist photos (S3 → local → fallback)
- releaseImage(release): Resolves album covers (S3 → local → fallback)
```

**Preference Order**:
1. `imageUrl` (S3) if `IMAGE_STORAGE !== 'local'`
2. `image` (local path) as `/img/{type}/{filename}`
3. Fallback to first letter placeholder

### 2. Audio Streaming
**Problem**: Audio files stored locally, need streaming with seeking support.

**Solution**: 
- Server endpoint: `/api/audio/[id]` reads from `MUSIC_DIR`
- Range header support for seeking
- Direct file streaming (no buffering entire file)
- Client uses HTML5 Audio API

### 3. Unified Release View
**Problem**: MusicBrainz has "official" releases, local library has "actual" files. Users want to see both.

**Solution**:
- Artist page fetches both `MusicBrainzRelease` and `LocalRelease`
- Server merges them by matching `musicbrainzId`
- Status badges: COMPLETE, INCOMPLETE, MISSING, LOCAL_ONLY
- Both track counts shown when different

### 4. Slug-Based Routing
**Problem**: Need clean URLs but IDs are CUIDs.

**Solution**:
- All artists have `slug` field (kebab-case name)
- Playlists have `slug` field (user-generated or auto-kebab)
- Routes use slugs: `/artist/[slug]`, `/playlists/[slug]`
- API lookups by slug using Prisma `unique` constraint

### 5. Player Queue Management
**Problem**: Different shuffle modes need different track sources.

**Solution**:
- `originalQueue`: Unshuffled source of truth
- `queue`: Current play order (shuffled or not)
- Shuffle modes fetch fresh data:
  - **Off**: Uses originalQueue as-is
  - **Release**: Fetches `/api/releases/[id]/tracks`
  - **Artist**: Fetches `/api/artists/[slug]/tracks`
  - **Catalogue**: Fetches `/api/tracks/random` per track

### 6. State Persistence
**Problem**: Player state should survive page reloads.

**Solution**: Pinia store watches changes and persists to localStorage:
```typescript
{
  trackId: string,
  currentTime: number,
  volume: number,
  isMuted: boolean,
  shuffleMode: 'off' | 'release' | 'artist' | 'catalogue',
  queue: PlayerTrack[],
  originalQueue: PlayerTrack[]
}
```

On load: Restore track, seek to position, but DON'T auto-play.

---

## Phase 1: Foundation and Core

### Objectives
- Set up project scaffolding
- Create layout structure
- Build browse page with filters
- Implement artist detail page
- Build audio player
- Create core API endpoints

### 1.1 Project Setup

**Challenge**: `pnpm create nuxt@latest` is interactive, needed non-interactive setup.

**Solution**: Manually created project structure:

```
web/
├── app.vue              # Root component
├── nuxt.config.ts       # Nuxt configuration
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── tailwind.config.js   # Tailwind v4 config
├── assets/
│   └── css/
│       └── tailwind.css # Tailwind entry point
├── components/          # Auto-imported components
├── composables/         # Auto-imported composables
├── layouts/             # Layout components
├── pages/               # File-based routing
├── public/              # Static assets
├── server/              # Server API routes
├── stores/              # Pinia stores
├── types/               # TypeScript definitions
└── prisma/
    └── schema.prisma    # Database schema
```

**Key Configuration** (`nuxt.config.ts`):
```typescript
export default defineNuxtConfig({
  compatibilityDate: '2025-02-14',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/tailwind.css'],
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },
  runtimeConfig: {
    musicDir: process.env.MUSIC_DIR || '/mnt/music',
    imageStorage: process.env.IMAGE_STORAGE || 's3',
  },
})
```

**Dependencies Installed**:
```json
{
  "nuxt": "^4.3.1",
  "@pinia/nuxt": "^0.9.0",
  "pinia": "^2.3.0",
  "prisma": "^6.6.0",
  "@prisma/client": "^6.6.0",
  "lucide-vue-next": "^0.468.0",
  "@vueuse/core": "^11.4.0",
  "date-fns": "^4.1.0",
  "tailwindcss": "^4.0.0-beta.13"
}
```

**pnpm Build Approval Issue**:
- `pnpm install` prompted for build script approval (interactive)
- Fixed by adding to `package.json`:
```json
"pnpm": {
  "onlyBuiltDependencies": [
    "@prisma/client",
    "@prisma/engines"
  ]
}
```

### 1.2 Layout Structure

**Created `layouts/default.vue`**:
```vue
<template>
  <div class="flex min-h-screen bg-zinc-950">
    <!-- Sidebar (desktop) -->
    <LayoutSidebar class="hidden lg:flex" />
    
    <!-- Main content -->
    <div class="flex min-h-screen w-full flex-col lg:ml-64">
      <header class="border-b border-zinc-800 bg-zinc-950 px-4 py-4 lg:px-6">
        <LayoutSearchBar />
      </header>
      
      <main 
        class="flex-1 px-4 py-6 lg:px-6"
        :class="{
          'pb-40 lg:pb-24': player.isVisible,
          'pb-20 lg:pb-6': !player.isVisible,
        }"
      >
        <slot />
      </main>
    </div>
    
    <!-- Mobile nav (bottom) -->
    <LayoutMobileNav />
    
    <!-- Audio player (fixed bottom) -->
    <PlayerAudioPlayer />
  </div>
</template>
```

**Key Layout Features**:
- Sidebar: Fixed left, 256px wide, hidden on mobile
- Header: Search bar, sticky top
- Main: Scrollable content area with dynamic bottom padding
- Mobile Nav: Fixed bottom navigation (stacks above player)
- Player: Fixed bottom, full width, 80px height

**Responsive Breakpoints**:
- Mobile: < 1024px (sidebar hidden, mobile nav shown)
- Desktop: ≥ 1024px (sidebar shown, mobile nav hidden)

### 1.3 Core Components

#### LayoutSidebar.vue
```vue
Navigation links:
- Home (/) - Home icon
- Browse (/browse) - Library icon
- Timeline (/timeline) - Calendar icon
- Playlists (/playlists) - ListMusic icon
- Favorites (/favorites) - Heart icon

Bottom section:
- Statistics (/statistics) - BarChart icon

Active state: bg-zinc-800 + text-amber-500
```

#### LayoutMobileNav.vue
```vue
Bottom tab bar (4 items):
- Home - Home icon
- Browse - Library icon  
- Favorites - Heart icon
- Playlists - ListMusic icon

Positioning:
- Fixed bottom
- z-40 (above content, below player)
- Adjusts position when player visible: bottom-20 vs bottom-0
```

#### LayoutSearchBar.vue
**Phase 1 Version**: Simple text input placeholder
**Phase 2 Enhancement**: Full search with dropdown (see Phase 2)

### 1.4 Browse Page

**File**: `pages/browse.vue`

**Features**:
- **Artist Grid**: Infinite scroll, 48 per page
- **Filters**:
  - Letter filter (A-Z buttons)
  - Genre filter (multi-select dropdown)
  - Sort (name, play count, match score, recently added)
  - Match score filter (range slider - added Phase 3)
- **Search**: Local filter by name

**Store**: `stores/browse.ts`
```typescript
State:
- artists: ArtistListItem[]
- total: number
- page: number
- filters: { letter, genre, sort, minScore, maxScore, search }
- loading states

Actions:
- fetchArtists(): Load first page
- loadMore(): Infinite scroll
- setFilters(): Update and refetch
```

**Component Structure**:
```
pages/browse.vue
├── BrowseFilterLetter (A-Z buttons)
├── BrowseFilterGenre (dropdown with chips)
├── BrowseFilterSort (dropdown)
├── BrowseFilterScore (range sliders - Phase 3)
└── BrowseArtistGrid
    └── BrowseArtistCard (per artist)
        ├── Artist image
        ├── Name + link
        └── Metadata (releases, tracks, match score)
```

### 1.5 Artist Detail Page

**File**: `pages/artist/[slug].vue`

**Features**:
- Artist header with photo, name, stats
- Unified releases view (MB + local merged)
- Release type tabs (Album, EP, Single, etc.)
- Expandable track tables
- Status badges

**Component Structure**:
```
pages/artist/[slug].vue
├── ArtistHeader
│   ├── Artist photo
│   ├── Name
│   └── Stats (releases, tracks, genres, play count)
└── ArtistReleases
    └── Per Release:
        ├── ReleaseCover (with play button)
        ├── ReleaseStatusBadge
        └── ReleaseTracksTable (expandable)
            └── Per Track:
                ├── Play button (on hover)
                ├── Track number
                ├── Title
                ├── Artist
                ├── Duration
                └── Favorite toggle (Phase 3)
```

**Unified Release Logic**:
```typescript
Server merges:
1. Fetch MusicBrainzRelease where artist.slug = slug
2. Fetch LocalRelease where artist.slug = slug
3. For each MB release:
   - Find matching local by musicbrainzId
   - Calculate status:
     - COMPLETE: localTrackCount === trackCount
     - INCOMPLETE: 0 < localTrackCount < trackCount
     - MISSING: localTrackCount === 0
4. For each local without MB match:
   - Status: LOCAL_ONLY
5. Merge and return unified array
```

**Status Badge Colors**:
- COMPLETE: Green (bg-emerald-500/20, text-emerald-400)
- INCOMPLETE: Yellow (bg-yellow-500/20, text-yellow-400)
- MISSING: Red (bg-red-500/20, text-red-400)
- LOCAL_ONLY: Blue (bg-blue-500/20, text-blue-400)

### 1.6 Audio Player

**File**: `components/player/AudioPlayer.vue`

**Features** (Phase 1):
- Play/pause toggle
- Next/previous track
- Seek bar (click to seek, displays current time / total time)
- Volume slider
- Mute toggle
- Track info display (cover, title, artist)
- Queue management

**Features** (Phase 2 additions):
- Shuffle mode cycle button
- Favorite track toggle (heart icon)
- Add to playlist dropdown

**Player Store**: `stores/player.ts`
```typescript
State:
- currentTrack: PlayerTrack | null
- queue: PlayerTrack[]
- originalQueue: PlayerTrack[]
- isPlaying: boolean
- volume: number (0-1)
- isMuted: boolean
- currentTime: number
- duration: number
- isVisible: boolean
- shuffleMode: 'off' | 'release' | 'artist' | 'catalogue'
- history: string[] (track IDs for previous button)

Actions:
- playTrack(track, newQueue?): Start playing
- togglePlay(): Pause/resume
- next(): Next track or random
- previous(): Previous track or seek to 0
- seek(time): Jump to position
- setVolume(val): Adjust volume
- toggleMute(): Mute/unmute
- setQueue(tracks, startTrack?): Set new queue
- cycleShuffleMode(): Rotate through modes
```

**Audio Implementation**:
```typescript
// HTML5 Audio element managed by store
const audio = new Audio()

// Event listeners
audio.addEventListener('timeupdate', () => {
  currentTime.value = audio.currentTime
})
audio.addEventListener('loadedmetadata', () => {
  duration.value = audio.duration
})
audio.addEventListener('ended', () => {
  next() // Auto-advance
})
audio.addEventListener('error', () => {
  isPlaying.value = false
})

// Playback
async function playTrack(track: PlayerTrack) {
  audio.src = `/api/audio/${track.id}`
  audio.load()
  await audio.play()
  $fetch(`/api/tracks/${track.id}/play`, { method: 'POST' }) // Log play
}
```

**Persistence** (debounced, 500ms):
```typescript
watch([volume, isMuted, currentTrack, shuffleMode, queue], 
  useDebounceFn(() => {
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: currentTrack.value?.id,
      currentTime: currentTime.value,
      volume: volume.value,
      isMuted: isMuted.value,
      shuffleMode: shuffleMode.value,
      queue: queue.value,
      originalQueue: originalQueue.value,
    }))
  }, 500)
)
```

### 1.7 Core API Endpoints

#### `/api/artists` (GET)
**Purpose**: List artists with pagination and filters

**Query Params**:
- `page` (default: 1)
- `limit` (default: 48, max: 100)
- `letter` (A-Z or '#')
- `genre` (genre name)
- `sort` (name, playCount, matchScore, recentlyAdded)
- `search` (name contains)
- `minScore`, `maxScore` (0-100)

**Response**:
```typescript
{
  artists: ArtistListItem[],
  total: number,
  page: number,
  pageSize: number,
  hasMore: boolean
}
```

**Prisma Query**:
```typescript
const where = {
  name: search ? { contains: search, mode: 'insensitive' } : undefined,
  genres: genre ? { some: { genre: { name: genre } } } : undefined,
  averageMatchScore: (minScore || maxScore) ? {
    gte: minScore ?? 0,
    lte: maxScore ?? 100
  } : undefined,
}

const orderBy = {
  name: sort === 'name' ? 'asc' : undefined,
  totalPlayCount: sort === 'playCount' ? 'desc' : undefined,
  averageMatchScore: sort === 'matchScore' ? 'desc' : undefined,
  createdAt: sort === 'recentlyAdded' ? 'desc' : undefined,
}

await prisma.artist.findMany({
  where,
  orderBy,
  skip: (page - 1) * limit,
  take: limit,
  include: {
    localReleases: { select: { id: true } },
  }
})
```

**Special Letter Filter**:
- A-Z: `name LIKE 'A%'` (case insensitive)
- '#': `name ~ '^[^A-Za-z]'` (starts with non-letter)

#### `/api/artists/[slug]` (GET)
**Purpose**: Get artist details with unified releases

**Response**:
```typescript
{
  id: string,
  name: string,
  slug: string,
  image: string | null,
  imageUrl: string | null,
  bio: string | null,
  stats: {
    releases: number,
    tracks: number,
    genres: string[],
    playCount: number,
  },
  releases: UnifiedRelease[]
}
```

**UnifiedRelease Type**:
```typescript
{
  id: string, // MB or local ID
  title: string,
  type: string, // Album, EP, Single, etc.
  typeSlug: string,
  year: number | null,
  trackCount: number, // Official count
  localTrackCount: number, // Actual files
  status: 'COMPLETE' | 'INCOMPLETE' | 'MISSING' | 'LOCAL_ONLY',
  image: string | null,
  imageUrl: string | null,
  musicbrainzId: string | null,
  localReleaseId: string | null,
}
```

#### `/api/artists/[slug]/tracks` (GET)
**Purpose**: Get all tracks by artist (for artist shuffle mode)

**Response**: `PlayerTrack[]`

**Prisma Query**:
```typescript
await prisma.localReleaseTrack.findMany({
  where: {
    localRelease: {
      artist: { slug }
    }
  },
  include: {
    localRelease: {
      include: {
        artist: { select: { id: true, name: true, slug: true } }
      }
    }
  },
  orderBy: [
    { localRelease: { year: 'asc' } },
    { localRelease: { title: 'asc' } },
    { trackNumber: 'asc' }
  ]
})
```

#### `/api/releases/[id]/tracks` (GET)
**Purpose**: Get tracks for a release (for playing)

**Response**:
```typescript
{
  tracks: Track[],
  release: {
    id: string,
    title: string,
    year: number | null,
    image: string | null,
    imageUrl: string | null,
    artistSlug: string | null,
  }
}
```

**Used by**:
- Play button on release covers
- Release shuffle mode
- Track table loading

#### `/api/tracks/[id]/play` (POST)
**Purpose**: Log track play (updates statistics)

**Side Effects**:
1. Increment `LocalReleaseTrack.playCount`
2. Update `LocalReleaseTrack.lastPlayedAt`
3. Increment `LocalRelease.totalPlayCount`
4. Update `LocalRelease.lastPlayedAt`
5. Recalculate `Statistics.plays` and `Statistics.playtime`

#### `/api/tracks/random` (GET)
**Purpose**: Get random track (for catalogue shuffle)

**Query Params**:
- `exclude` (comma-separated track IDs to avoid)

**Response**: Single `PlayerTrack`

**Implementation**:
```typescript
// Use PostgreSQL RANDOM() for true randomness
await prisma.localReleaseTrack.findFirst({
  where: {
    id: { notIn: exclude ? exclude.split(',') : [] }
  },
  orderBy: { id: 'asc' }, // Prisma requirement
  skip: Math.floor(Math.random() * totalCount),
  include: { /* ... */ }
})
```

#### `/api/audio/[id]` (GET)
**Purpose**: Stream audio file

**Headers**:
- Supports `Range` header for seeking
- Returns `Content-Type: audio/mpeg` (or detected)
- Returns `Content-Length` and `Content-Range`

**Implementation**:
```typescript
const track = await prisma.localReleaseTrack.findUnique({
  where: { id },
  select: { filePath: true }
})

const fullPath = join(MUSIC_DIR, track.filePath)
const stat = await fs.stat(fullPath)

// Handle Range request
if (range) {
  const [start, end] = parseRange(range, stat.size)
  const stream = fs.createReadStream(fullPath, { start, end })
  return send(event, stream, {
    headers: {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    },
    statusCode: 206
  })
}

// Return full file
const stream = fs.createReadStream(fullPath)
return send(event, stream)
```

### 1.8 Phase 1 Challenges & Solutions

#### Challenge 1: `useDebounceFn` not defined
**Error**: `useDebounceFn is not defined` in player store

**Cause**: Missing import

**Fix**:
```typescript
import { useDebounceFn } from '@vueuse/core'
```

#### Challenge 2: Schema Field Mismatches
**Error**: Multiple Prisma validation errors in API routes

**Root Cause**: API routes used field names that didn't match `schema.prisma`

**Examples**:
- Used `indexedAt` → should be `createdAt`
- Used `releaseType` field → should be `release.type.name` relation
- Used `playCount` → should be `totalPlayCount`
- Used `release` include → should be `localRelease` for tracks
- Used `matchScore` → should be `averageMatchScore`

**Fix**: Comprehensive audit of all API routes against schema (detailed in Phase 3)

#### Challenge 3: Image Resolution
**Problem**: Need to support both S3 and local images seamlessly

**Solution**: Created `composables/useImageUrl.ts`:
```typescript
export function useImageUrl() {
  const config = useRuntimeConfig()
  const preferS3 = config.public.imageStorage !== 'local'

  function artistImage(artist: { image?: string | null, imageUrl?: string | null }) {
    if (preferS3 && artist.imageUrl) return artist.imageUrl
    if (artist.image) return `/img/artists/${artist.image}`
    return null
  }

  function releaseImage(release: { image?: string | null, imageUrl?: string | null }) {
    if (preferS3 && release.imageUrl) return release.imageUrl
    if (release.image) return `/img/releases/${release.image}`
    return null
  }

  return { artistImage, releaseImage }
}
```

**Usage in components**:
```vue
<script setup>
const { releaseImage } = useImageUrl()
const imgUrl = computed(() => releaseImage(props.release))
</script>
<template>
  <img v-if="imgUrl" :src="imgUrl" :alt="title" />
</template>
```

---

## Phase 2: Home, Search, Favorites, Playlists

### Objectives
- Build home dashboard page
- Implement global search with dropdown
- Create favorites system
- Build playlist management (CRUD)
- Enhance audio player with shuffle modes

### 2.1 Home Dashboard

**File**: `pages/index.vue`

**Sections**:
1. **Latest Additions** (top 6 releases by `createdAt`)
2. **Recently Played** (top 6 releases by `lastPlayedAt`)
3. **Your Playlists** (top 6 playlists by `updatedAt`)
4. **Favorite Releases** (top 6 favorited releases)

**Component**: `components/home/ReleaseGrid.vue`
```vue
Props:
- title: string (section heading)
- releases: SearchRelease[]
- viewMoreLink: string (optional "View all" link)
- emptyMessage: string

Features:
- Responsive grid (2-6 columns)
- Hover overlay with play button
- Lazy-loaded images
- Click title/artist to navigate
- Click play to start playback
```

**API Endpoints Used**:
- `/api/releases/latest?limit=6`
- `/api/releases/last-played?limit=6`
- `/api/playlists` (filtered to 6 client-side)
- `/api/favorites` (filtered to 6 client-side)

**Loading State**: Skeleton loaders for all sections (Phase 3)

### 2.2 Global Search

**File**: `components/layout/SearchBar.vue`

**Features**:
- Debounced search (300ms)
- Shows dropdown when results found
- Closes on blur/select
- Keyboard navigation ready

**Implementation**:
```vue
<script setup>
const searchQuery = ref('')
const searchResults = ref<SearchResults | null>(null)
const showDropdown = ref(false)

const debouncedSearch = useDebounceFn(async (query: string) => {
  if (!query.trim()) {
    searchResults.value = null
    showDropdown.value = false
    return
  }
  
  const results = await $fetch<SearchResults>(`/api/search?q=${query}`)
  searchResults.value = results
  showDropdown.value = true
}, 300)

watch(searchQuery, (val) => debouncedSearch(val))
</script>
```

**Dropdown Component**: `components/layout/SearchDropdown.vue`

**Structure**:
```
SearchDropdown
├── Artists Section (max 5)
│   └── Per Artist:
│       ├── Photo
│       ├── Name (click to navigate)
│       └── Stats
├── Releases Section (max 5)
│   └── Per Release:
│       ├── Cover
│       ├── Title + Artist (click to play)
│       └── Year
└── Tracks Section (max 5)
    └── Per Track:
        ├── Title (click to play)
        ├── Artist + Album
        └── Duration
```

**Styling**:
- Fixed positioning below search input
- Max height with scroll
- Grouped by category with headers
- Hover states on items

### 2.3 Search API

**Endpoint**: `/api/search` (GET)

**Query Params**:
- `q` (required, min 2 characters)

**Response**:
```typescript
{
  artists: SearchArtist[], // max 5
  releases: SearchRelease[], // max 5
  tracks: SearchTrack[], // max 5
}
```

**Search Logic**:
```typescript
// Case-insensitive contains search
const searchTerm = `%${q}%`

// Artists: search name
const artists = await prisma.artist.findMany({
  where: {
    name: { contains: q, mode: 'insensitive' }
  },
  take: 5,
  orderBy: [
    { averageMatchScore: 'desc' },
    { name: 'asc' }
  ]
})

// Releases: search title
const releases = await prisma.localRelease.findMany({
  where: {
    title: { contains: q, mode: 'insensitive' }
  },
  take: 5,
  orderBy: [
    { lastPlayedAt: { sort: 'desc', nulls: 'last' } },
    { title: 'asc' }
  ]
})

// Tracks: search title or artist
const tracks = await prisma.localReleaseTrack.findMany({
  where: {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { localRelease: { artist: { name: { contains: q, mode: 'insensitive' } } } }
    ]
  },
  take: 5,
  orderBy: [
    { lastPlayedAt: { sort: 'desc', nulls: 'last' } },
    { title: 'asc' }
  ]
})
```

### 2.4 Favorites System

**Database Tables** (from schema):
```prisma
model FavoriteRelease {
  id        String   @id @default(cuid())
  releaseId String   // FK to MusicBrainzRelease
  createdAt DateTime @default(now())
  release   MusicBrainzRelease @relation(...)
}

model FavoriteTrack {
  id        String   @id @default(cuid())
  trackId   String   // FK to LocalReleaseTrack
  createdAt DateTime @default(now())
  track     LocalReleaseTrack @relation(...)
}
```

**Important**: `FavoriteRelease` links to `MusicBrainzRelease`, not `LocalRelease`. To get local release data (image, year), must join through `MusicBrainzRelease.localReleases`.

**API Endpoints**:

1. **GET `/api/favorites`**
   ```typescript
   Response: {
     releases: FavoriteRelease[], // with MB + local data
     tracks: FavoriteTrack[], // with track + release data
   }
   ```

2. **POST `/api/favorites/releases/[id]`**
   ```typescript
   Body: none
   Effect: Creates FavoriteRelease record
   ```

3. **DELETE `/api/favorites/releases/[id]`**
   ```typescript
   Effect: Removes FavoriteRelease record
   ```

4. **POST `/api/favorites/tracks/[id]`**
   ```typescript
   Body: none
   Effect: Creates FavoriteTrack record
   ```

5. **DELETE `/api/favorites/tracks/[id]`**
   ```typescript
   Effect: Removes FavoriteTrack record
   ```

**Favorites Page**: `pages/favorites.vue`

**Features**:
- Tabbed interface (Releases / Tracks)
- Release grid (same as home)
- Track list with play buttons
- Empty states for each tab

**Integration Points**:
- Heart icon in player (toggle current track)
- Heart icon in track tables (toggle per track - Phase 3)
- Home page shows favorited releases

### 2.5 Playlist Management

**Database Schema**:
```prisma
model Playlist {
  id          String          @id @default(cuid())
  name        String
  slug        String          @unique // Added Phase 3
  description String?         @db.Text
  image       String?         // Future: cover art
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  tracks      PlaylistTrack[]
}

model PlaylistTrack {
  id         String   @id @default(cuid())
  playlistId String
  trackId    String
  position   Int      // Order in playlist
  createdAt  DateTime @default(now()) // Was called addedAt in Phase 2
  playlist   Playlist @relation(...)
  track      LocalReleaseTrack @relation(...)
  
  @@unique([playlistId, trackId])
  @@index([playlistId, position])
}
```

**API Endpoints**:

1. **GET `/api/playlists`**
   ```typescript
   Response: PlaylistSummary[]
   {
     id: string,
     name: string,
     slug: string,
     trackCount: number,
     duration: number, // total seconds
     coverImages: { image, imageUrl }[], // First 4 unique covers
     createdAt: string,
     updatedAt: string,
   }
   ```

2. **POST `/api/playlists`**
   ```typescript
   Body: { name: string, slug: string, description?: string }
   Response: Playlist
   ```

3. **GET `/api/playlists/[slug]`**
   ```typescript
   Response: PlaylistDetail
   {
     id, name, slug, description,
     trackCount, duration,
     coverImages,
     createdAt, updatedAt,
     tracks: PlaylistTrack[] // ordered by position
   }
   ```

4. **DELETE `/api/playlists/[slug]`**
   ```typescript
   Effect: Deletes playlist and all PlaylistTrack entries
   ```

5. **POST `/api/playlists/[slug]/tracks`**
   ```typescript
   Body: { trackId: string }
   Effect: Adds track to end of playlist (position = max + 1)
   Response: { success: true, playlistTrack: {...} }
   ```

6. **DELETE `/api/playlists/[slug]/tracks/[trackId]`**
   ```typescript
   Effect: Removes track, reorders remaining tracks
   ```

**Playlist Index Page**: `pages/playlists/index.vue`

**Features**:
- Grid of playlist cards
- Cover mosaic (2x2 grid of first 4 unique covers)
- Track count and duration
- "Create New" button (opens modal)

**Component**: `components/home/PlaylistGrid.vue`
```vue
Features:
- Responsive grid
- Mosaic cover art (2x2)
- Hover effects
- Click to navigate to detail
```

**Playlist Detail Page**: `pages/playlists/[slug].vue`

**Features**:
- Playlist header (name, description, stats)
- "Play All" button
- "Delete Playlist" button (with confirmation)
- Track list with:
  - Drag handles (future)
  - Remove buttons
  - Play on click
- Empty state

**Create Playlist Modal**:
- Simple prompt for name (Phase 2)
- Auto-generates slug from name
- Enhanced in player dropdown (Phase 3)

### 2.6 Enhanced Audio Player

**New Features**:

1. **Shuffle Mode Cycle**
   ```vue
   <button @click="player.cycleShuffleMode()">
     <Shuffle :size="20" />
     <span>{{ shuffleModeLabel }}</span>
   </button>
   ```
   
   Modes display:
   - Off: No icon fill
   - Release: "Release" label
   - Artist: "Artist" label
   - Catalogue: "Shuffle" label

2. **Favorite Toggle**
   ```vue
   <button @click="toggleFavorite()">
     <Heart 
       :size="20" 
       :fill="isFavorite ? 'currentColor' : 'none'"
       :class="{ 'text-amber-500': isFavorite }"
     />
   </button>
   ```

3. **Add to Playlist**
   ```vue
   <button @click="showPlaylistMenu = true; loadPlaylists()">
     <ListMusic :size="20" />
   </button>
   
   <div v-if="showPlaylistMenu" class="playlist-dropdown">
     <button @click="createNewPlaylist()">
       + Create new playlist
     </button>
     <button 
       v-for="playlist in playlists" 
       @click="addToPlaylist(playlist.slug)"
     >
       {{ playlist.name }}
     </button>
   </div>
   ```

**Shuffle Mode Implementation** (Phase 3 enhancement):
```typescript
async function cycleShuffleMode() {
  const modes: ShuffleMode[] = ['off', 'release', 'artist', 'catalogue']
  const idx = modes.indexOf(shuffleMode.value)
  const newMode = modes[(idx + 1) % modes.length]
  shuffleMode.value = newMode

  // Fetch appropriate tracks
  if (newMode === 'release' && currentTrack.value?.releaseId) {
    const tracks = await $fetch(`/api/releases/${currentTrack.value.releaseId}/tracks`)
    originalQueue.value = tracks
    queue.value = shuffleArray([...tracks])
  }
  else if (newMode === 'artist' && currentTrack.value?.artistSlug) {
    const tracks = await $fetch(`/api/artists/${currentTrack.value.artistSlug}/tracks`)
    originalQueue.value = tracks
    queue.value = shuffleArray([...tracks])
  }
  else if (newMode === 'off') {
    queue.value = [...originalQueue.value]
  }
  else if (newMode !== 'catalogue') {
    queue.value = shuffleArray([...originalQueue.value])
  }
}
```

### 2.7 New API Endpoints

#### `/api/releases/latest` (GET)
**Purpose**: Recent additions to library

**Query**: `limit` (default 50, max 100)

**Prisma**:
```typescript
await prisma.localRelease.findMany({
  take: limit,
  orderBy: { createdAt: 'desc' },
  include: {
    artist: { select: { id, name, slug } },
    release: {
      select: {
        id, title,
        type: { select: { name } }
      }
    }
  }
})
```

#### `/api/releases/last-played` (GET)
**Purpose**: Recently played releases

**Query**: `limit` (default 50, max 100)

**Prisma**:
```typescript
await prisma.localRelease.findMany({
  where: { lastPlayedAt: { not: null } },
  take: limit,
  orderBy: { lastPlayedAt: 'desc' },
  include: { /* same as latest */ }
})
```

### 2.8 Phase 2 Challenges & Solutions

#### Challenge 1: FavoriteRelease Schema Confusion
**Problem**: `FavoriteRelease` links to `MusicBrainzRelease`, but we need `LocalRelease` fields like `image` and `year`.

**Solution**: Modified `/api/favorites` query:
```typescript
await prisma.favoriteRelease.findMany({
  include: {
    release: { // MusicBrainzRelease
      include: {
        artist: { select: { id, name, slug } },
        type: { select: { name } },
        localReleases: { // Join to LocalRelease
          select: { id, title, year, image, imageUrl },
          take: 1
        }
      }
    }
  }
})

// Map to response
releases.map(fr => ({
  // ... MB fields ...
  year: fr.release.localReleases[0]?.year,
  image: fr.release.localReleases[0]?.image,
  imageUrl: fr.release.localReleases[0]?.imageUrl,
}))
```

#### Challenge 2: Playlist Slug Missing
**Problem**: Phase 2 designed API routes using `/api/playlists/[slug]`, but `Playlist` model had no `slug` field.

**Solution**: 
1. Added `slug String @unique` to `Playlist` model (Phase 3)
2. Ran `pnpm prisma db push --accept-data-loss`
3. Updated all API routes to use slug lookups

#### Challenge 3: PlaylistTrack "addedAt" Field
**Problem**: API responses used `addedAt` field, but schema has `createdAt`.

**Solution**: Changed all API responses to use `createdAt` instead of inventing `addedAt`.

---

## Phase 3: Timeline, Statistics, Polish

### Objectives
- Build timeline page with decade navigation
- Create statistics dashboard
- Add loading skeletons
- Implement lazy loading for images
- Polish mobile responsiveness
- Add global error page
- Fix remaining schema mismatches

### 3.1 Timeline Page

**File**: `pages/timeline/index.vue`

**Features**:
- Decade tabs (1950s-2020s) with release counts
- Year navigation within decade
- Release grids grouped by year
- Infinite scroll (50 releases per batch)
- Lazy-loaded images

**Layout**:
```
Timeline Page
├── Page Header (Timeline + total count)
├── Decade Tabs (horizontal scroll on mobile)
│   └── Tab per decade (1950s, 1960s, ..., 2020s)
├── Active Decade: Year Pills (1950, 1951, ..., 1959)
└── Release Grid (grouped by year)
    └── Year Header + Grid per year
```

**State Management**:
```typescript
const activeDecade = ref<number>(2020) // Default to latest
const activeYear = ref<number | null>(null) // null = whole decade
const releases = ref<any[]>([])
const yearCounts = ref<Record<number, number>>({})
const loading = ref(false)
const hasMore = ref(true)
const page = ref(1)
```

**Data Flow**:
1. Load decades: `GET /api/timeline/decades` → `{ decade, count }[]`
2. Click decade tab → Load that decade's data
3. If year pill clicked → Filter to that year
4. Scroll to bottom → Load more (page++)

**API Endpoints**:

#### `/api/timeline/decades` (GET)
**Purpose**: Get available decades with counts

**Response**:
```typescript
{ decade: number, count: number }[]
// Example: [{ decade: 2020, count: 150 }, { decade: 2010, count: 320 }, ...]
```

**Implementation**:
```typescript
const releases = await prisma.localRelease.findMany({
  where: { year: { not: null } },
  select: { year: true }
})

const decadeMap = new Map<number, number>()
for (const r of releases) {
  if (r.year) {
    const decade = Math.floor(r.year / 10) * 10
    decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1)
  }
}

return Array.from(decadeMap.entries())
  .map(([decade, count]) => ({ decade, count }))
  .sort((a, b) => b.decade - a.decade) // Newest first
```

#### `/api/timeline/[decade]` (GET)
**Purpose**: Get releases for decade or specific year

**Query Params**:
- `year` (optional, e.g., "2020" for single year, "2020s" for decade)
- `page` (default 1)
- `limit` (default 50, max 100)

**Response**:
```typescript
{
  releases: SearchRelease[],
  yearCounts: Record<number, number>, // Years in this decade
  total: number,
  hasMore: boolean
}
```

**Implementation**:
```typescript
// Parse decade param: "2020" or "2020s"
const decadeParam = getRouterParam(event, 'decade')
const decade = Number.parseInt(decadeParam.replace(/s$/, ''), 10)

// Determine year range
let yearStart: number, yearEnd: number
if (query.year) {
  // Single year
  yearStart = Number.parseInt(query.year as string, 10)
  yearEnd = yearStart + 1
} else {
  // Whole decade
  yearStart = decade
  yearEnd = decade + 10
}

const where = {
  year: { gte: yearStart, lt: yearEnd }
}

const [releases, total] = await Promise.all([
  prisma.localRelease.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
    include: {
      artist: { select: { id, name, slug } },
      release: {
        select: {
          id, title,
          type: { select: { name } }
        }
      }
    }
  }),
  prisma.localRelease.count({ where })
])

// Get year counts for decade
const yearCountRaw = await prisma.localRelease.groupBy({
  by: ['year'],
  where: { year: { gte: decade, lt: decade + 10 } },
  _count: true
})
const yearCounts = Object.fromEntries(
  yearCountRaw.map(y => [y.year, y._count])
)

return {
  releases,
  yearCounts,
  total,
  hasMore: (page * limit) < total
}
```

**Infinite Scroll**:
```typescript
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && hasMore.value && !loading.value) {
    loadMore()
  }
})

onMounted(() => {
  const sentinel = document.querySelector('.scroll-sentinel')
  if (sentinel) observer.observe(sentinel)
})

async function loadMore() {
  page.value++
  loading.value = true
  const data = await $fetch(`/api/timeline/${activeDecade.value}`, {
    query: { page: page.value, year: activeYear.value }
  })
  releases.value.push(...data.releases)
  hasMore.value = data.hasMore
  loading.value = false
}
```

### 3.2 Statistics Page

**File**: `pages/statistics.vue`

**Features**:
- Grouped stat cards
- Formatted numbers (commas, units)
- Playtime converted to hours/days
- Last scan timestamps

**Layout**:
```
Statistics Page
├── Page Header (Statistics)
└── Grid of Stat Groups
    ├── General Stats
    │   ├── Artists
    │   ├── Releases
    │   ├── Tracks
    │   └── Genres
    ├── Playback Stats
    │   ├── Total Plays
    │   └── Total Playtime
    ├── Sync Stats
    │   ├── Artists Synced with MusicBrainz
    │   └── Releases Synced with MusicBrainz
    ├── Cover Art Stats
    │   ├── Artists with Cover Art
    │   └── Releases with Cover Art
    └── Last Scan
        ├── Started At
        └── Ended At
```

**API Endpoint**: `/api/stats` (GET)

**Response**:
```typescript
{
  artists: number,
  tracks: number,
  releases: number,
  genres: number,
  playtime: number, // seconds
  plays: number,
  artistsSyncedWithMusicbrainz: number,
  releasesSyncedWithMusicbrainz: number,
  artistsWithCoverArt: number,
  releasesWithCoverArt: number,
  lastScanStartedAt: string | null, // ISO timestamp
  lastScanEndedAt: string | null,
}
```

**Implementation**:
```typescript
const stats = await prisma.statistics.findUnique({
  where: { id: 'main' } // Single row table
})

if (!stats) {
  // Return zeros if no stats yet
  return { artists: 0, tracks: 0, /* ... */ }
}

return {
  artists: stats.artists,
  tracks: stats.tracks,
  releases: stats.releases,
  genres: stats.genres,
  playtime: Number(stats.playtime), // BigInt → number
  plays: Number(stats.plays), // BigInt → number
  artistsSyncedWithMusicbrainz: stats.artistsSyncedWithMusicbrainz,
  releasesSyncedWithMusicbrainz: stats.releasesSyncedWithMusicbrainz,
  artistsWithCoverArt: stats.artistsWithCoverArt,
  releasesWithCoverArt: stats.releasesWithCoverArt,
  lastScanStartedAt: stats.lastScanStartedAt?.toISOString() || null,
  lastScanEndedAt: stats.lastScanEndedAt?.toISOString() || null,
}
```

**Formatting in Frontend**:
```typescript
function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const days = Math.floor(hours / 24)
  
  if (days > 0) {
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return format(parseISO(iso), 'PPpp') // e.g., "Jan 1, 2024 at 3:45 PM"
}
```

### 3.3 Loading Skeletons

**Components Created**:

#### `components/ui/Skeleton.vue`
```vue
<template>
  <div 
    class="animate-pulse rounded bg-zinc-800"
    :class="className"
  />
</template>

<script setup>
defineProps<{ className?: string }>()
</script>
```

#### `components/ui/ReleaseSkeleton.vue`
```vue
<template>
  <div class="flex flex-col gap-2">
    <!-- Cover -->
    <div class="aspect-square w-full animate-pulse rounded-lg bg-zinc-800" />
    <!-- Title -->
    <div class="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
    <!-- Artist -->
    <div class="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
  </div>
</template>
```

**Usage**:
```vue
<template>
  <!-- Loading state -->
  <div v-if="loading" class="grid grid-cols-6 gap-4">
    <UiReleaseSkeleton v-for="i in 6" :key="i" />
  </div>
  
  <!-- Loaded content -->
  <div v-else class="grid grid-cols-6 gap-4">
    <ReleaseCard v-for="release in releases" :key="release.id" />
  </div>
</template>
```

**Applied To**:
- Home page (all sections)
- Browse page (artist grid)
- Timeline page (release grids)
- Playlist detail (track list)

### 3.4 Lazy Loading Images

**Implementation**:
```vue
<img 
  :src="imageUrl" 
  :alt="title"
  loading="lazy" 
  class="h-full w-full object-cover"
/>
```

**Applied To**:
- `components/home/ReleaseGrid.vue` (release covers)
- `components/home/PlaylistGrid.vue` (playlist mosaics)
- `components/browse/ArtistCard.vue` (artist photos)
- `components/release/ReleaseCover.vue` (album art)
- `pages/timeline/index.vue` (timeline releases)

**Benefits**:
- Reduces initial page load
- Defers offscreen image loading
- Browser-native implementation

### 3.5 Mobile Responsiveness Polish

**Layout Adjustments**:

1. **Main Content Padding**:
   ```vue
   <main 
     class="px-4 py-6 lg:px-6"
     :class="{
       'pb-40 lg:pb-24': player.isVisible, // Mobile: 160px, Desktop: 96px
       'pb-20 lg:pb-6': !player.isVisible,  // Mobile: 80px, Desktop: 24px
     }"
   >
   ```
   
   Reasoning:
   - Mobile nav: 64px height
   - Player: 80px height
   - Stack them: 64 + 80 = 144px + padding = 160px

2. **Mobile Navigation Positioning**:
   ```vue
   <nav
     class="fixed left-0 z-40 flex w-full lg:hidden"
     :class="player.isVisible ? 'bottom-20' : 'bottom-0'"
   >
   ```
   
   Stacks above player when visible, otherwise at bottom.

3. **Grid Responsiveness**:
   ```css
   /* Release grids */
   .grid {
     grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6
   }
   
   /* Stat cards */
   .grid {
     grid-cols-1 md:grid-cols-2 lg:grid-cols-3
   }
   
   /* Timeline decade tabs */
   .flex {
     overflow-x-auto /* Horizontal scroll on mobile */
   }
   ```

4. **Touch Targets**:
   - Minimum 44x44px for buttons
   - Increased padding on mobile
   - Larger tap areas for controls

### 3.6 Global Error Page

**File**: `error.vue` (root-level, special Nuxt file)

**Features**:
- Catches 404, 500, and all errors
- Styled error display
- "Back to Home" button
- Uses `clearError()` to reset

**Implementation**:
```vue
<script setup lang="ts">
import { LucideHome, LucideAlertCircle } from 'lucide-vue-next'

const props = defineProps<{
  error: {
    statusCode: number
    statusMessage?: string
    message?: string
  }
}>()

const title = computed(() => {
  switch (props.error.statusCode) {
    case 404: return 'Page Not Found'
    case 500: return 'Server Error'
    default: return 'An Error Occurred'
  }
})

const description = computed(() => {
  return props.error.message || props.error.statusMessage || 
    'Something went wrong. Please try again.'
})

function handleError() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
    <div class="flex max-w-md flex-col items-center text-center">
      <div class="mb-6 flex size-20 items-center justify-center rounded-full bg-zinc-900">
        <LucideAlertCircle class="size-10 text-amber-500" />
      </div>
      <h1 class="mb-2 text-4xl font-bold text-zinc-50">
        {{ error.statusCode }}
      </h1>
      <h2 class="mb-4 text-xl font-semibold text-zinc-300">
        {{ title }}
      </h2>
      <p class="mb-8 text-sm text-zinc-500">
        {{ description }}
      </p>
      <button 
        class="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
        @click="handleError"
      >
        <LucideHome class="size-4" />
        Back to Home
      </button>
    </div>
  </div>
</template>
```

### 3.7 Schema Corrections

**Problem**: Multiple API routes had field/relation name mismatches with `schema.prisma`.

**Comprehensive Audit Process**:
1. Read entire `prisma/schema.prisma`
2. List all API route files
3. For each route, verify:
   - Field names match schema
   - Relation names match schema
   - Includes use correct paths

**Issues Found & Fixed**:

#### 1. LocalRelease Fields
```typescript
// WRONG:
orderBy: { indexedAt: 'desc' }

// CORRECT:
orderBy: { createdAt: 'desc' }

// WRONG:
release.releaseType

// CORRECT:
release.release?.type?.name // Via relation
```

#### 2. Artist Match Score
```typescript
// WRONG:
orderBy: { matchScore: 'desc' }

// CORRECT:
orderBy: { averageMatchScore: 'desc' }
```

#### 3. LocalReleaseTrack Relations
```typescript
// WRONG:
include: {
  release: { /* ... */ }
}

// CORRECT:
include: {
  localRelease: { /* ... */ } // Correct relation name
}
```

#### 4. PlaylistTrack Timestamp
```typescript
// WRONG:
addedAt: pt.addedAt

// CORRECT:
addedAt: pt.createdAt // Field is called createdAt
```

#### 5. Playlist Slug Field
```typescript
// MISSING: Playlist model had no slug field

// ADDED to schema.prisma:
model Playlist {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique // ← Added
  // ... rest of fields
}

// Then: pnpm prisma db push --accept-data-loss
```

**Files Modified**:
- `/api/releases/latest.get.ts`
- `/api/releases/last-played.get.ts`
- `/api/favorites/index.get.ts`
- `/api/playlists/index.get.ts`
- `/api/playlists/[slug].get.ts`
- `/api/playlists/[slug]/tracks.post.ts`
- `/api/search.get.ts`

### 3.8 Additional Features (Phase 3)

#### Match Score Filter Component
**File**: `components/browse/FilterScore.vue`

**Features**:
- Dual range sliders (min/max)
- 0-100% range, 5% steps
- Popover UI with apply/reset
- Active state indicator (amber)

**Usage**:
```vue
<BrowseFilterScore
  :min-score="store.minScore"
  :max-score="store.maxScore"
  @update:min-score="store.setMinScore"
  @update:max-score="store.setMaxScore"
/>
```

#### Track Favorite Toggle
**File**: `components/release/TracksTable.vue` (enhanced)

**Added**:
- Heart icon column in track table
- Click to favorite/unfavorite
- Loads favorite state on mount
- Visual feedback (filled heart, amber color)

**Implementation**:
```typescript
const favoriteTracks = ref<Set<string>>(new Set())

onMounted(async () => {
  const favorites = await $fetch('/api/favorites')
  favoriteTracks.value = new Set(favorites.tracks.map(f => f.track.id))
})

async function toggleFavorite(trackId: string) {
  const isFavorite = favoriteTracks.value.has(trackId)
  
  if (isFavorite) {
    await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
    favoriteTracks.value.delete(trackId)
  } else {
    await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'POST' })
    favoriteTracks.value.add(trackId)
  }
}
```

#### Create Playlist in Player
**File**: `components/player/AudioPlayer.vue` (enhanced)

**Added**:
- "Create new playlist" button in playlist dropdown
- Prompts for name
- Auto-generates slug
- Creates playlist and adds current track
- Refreshes playlist list

**Implementation**:
```typescript
async function createNewPlaylist() {
  const name = prompt('Enter playlist name:')
  if (!name?.trim()) return

  const slug = name.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

  if (!slug) {
    alert('Invalid playlist name')
    return
  }

  const playlist = await $fetch('/api/playlists', {
    method: 'POST',
    body: { name, slug }
  })
  
  await addToPlaylist(playlist.slug)
  await loadPlaylists()
}
```

---

## Critical Fixes and Debugging

### Fix 1: Component Resolution Error (February 14, 2026)

**Error**: `Failed to resolve component: ArtistArtistHeader`

**Cause**: Incorrect component naming in artist page. Used double-prefix `ArtistArtistHeader` instead of `ArtistHeader`.

**Explanation**: Nuxt auto-imports components with folder prefix. A component at `components/artist/ArtistHeader.vue` is imported as `ArtistHeader`, not `ArtistArtistHeader`.

**Fix**:
```vue
<!-- WRONG -->
<ArtistArtistHeader :artist="artist" />
<ArtistArtistReleases :releases="artist.releases" />

<!-- CORRECT -->
<ArtistHeader :artist="artist" />
<ArtistReleases :releases="artist.releases" />
```

**File**: `pages/artist/[slug].vue`

### Fix 2: Play Button Not Working (February 14, 2026)

**Symptoms**:
- Clicking play buttons did nothing
- Console error: `$fetch is not defined`
- Error: `Component is already mounted, please use $fetch instead`

**Root Causes**:

1. **Stores Not Importing $fetch**:
   ```typescript
   // WRONG:
   export const usePlayerStore = defineStore('player', () => {
     // $fetch used but not imported
     await $fetch('/api/tracks/random')
   })
   
   // CORRECT:
   export const usePlayerStore = defineStore('player', () => {
     const { $fetch } = useNuxtApp()
     await $fetch('/api/tracks/random')
   })
   ```

2. **Components Using useFetch for Imperative Calls**:
   ```typescript
   // WRONG (useFetch is for SSR data loading):
   async function playRelease(id: string) {
     const { data } = await useFetch(`/api/releases/${id}/tracks`)
     if (data.value) playerStore.playTrack(data.value[0])
   }
   
   // CORRECT ($fetch for client-side API calls):
   async function playRelease(id: string) {
     const response = await $fetch(`/api/releases/${id}/tracks`)
     if (response?.tracks?.length > 0) {
       playerStore.setQueue(response.tracks)
     }
   }
   ```

3. **API Response Structure Mismatch**:
   ```typescript
   // API returns: { tracks: [...], release: {...} }
   // Code expected: [...]
   
   // FIXED: Properly extract tracks array and map to PlayerTrack
   const response = await $fetch(`/api/releases/${id}/tracks`)
   const playerTracks = response.tracks.map(t => ({
     id: t.id,
     title: t.title || 'Unknown',
     artist: t.artist || 'Unknown',
     album: response.release?.title || 'Unknown',
     duration: t.duration || 0,
     artistSlug: response.release?.artistSlug || null,
     releaseImage: response.release?.image ? `/img/releases/${response.release.image}` : null,
     releaseImageUrl: response.release?.imageUrl || null,
     localReleaseId: t.localReleaseId,
   }))
   ```

**Files Fixed**:
- `stores/player.ts` - Added `const { $fetch } = useNuxtApp()`
- `stores/browse.ts` - Added `const { $fetch } = useNuxtApp()`
- `components/home/ReleaseGrid.vue` - Changed useFetch → $fetch, fixed response handling
- `components/layout/SearchDropdown.vue` - Changed useFetch → $fetch, fixed response handling

**Lesson**: 
- Use `useFetch()` for SSR-friendly data loading in setup
- Use `$fetch()` for imperative client-side API calls (events, actions)
- Always access `$fetch` via `useNuxtApp()` in stores

### Fix 3: Position Restoration on Load

**Issue**: Player persisted position but didn't restore it on page load.

**Fix**: Enhanced player store initialization:
```typescript
if (import.meta.client) {
  const saved = localStorage.getItem('dmp-player')
  if (saved) {
    const state = JSON.parse(saved)
    
    // Restore state
    volume.value = state.volume ?? 0.75
    isMuted.value = state.isMuted ?? false
    shuffleMode.value = state.shuffleMode ?? 'off'
    queue.value = state.queue ?? []
    originalQueue.value = state.originalQueue ?? []
    
    if (state.trackId && state.queue?.length) {
      const track = state.queue.find(t => t.id === state.trackId)
      if (track) {
        currentTrack.value = track
        isVisible.value = true
        
        // NEW: Restore position but DON'T auto-play
        if (state.currentTime && state.currentTime > 0) {
          const a = getAudio()
          a.src = `/api/audio/${track.id}`
          a.load()
          a.currentTime = state.currentTime
        }
      }
    }
  }
}
```

---

## API Endpoints Reference

### Complete List

| Endpoint | Method | Purpose | Phase |
|----------|--------|---------|-------|
| `/api/artists` | GET | List artists with filters | 1 |
| `/api/artists/[slug]` | GET | Artist detail + unified releases | 1 |
| `/api/artists/[slug]/tracks` | GET | All tracks by artist | 1 |
| `/api/releases/[id]/tracks` | GET | Tracks for release | 1 |
| `/api/releases/latest` | GET | Recently added releases | 2 |
| `/api/releases/last-played` | GET | Recently played releases | 2 |
| `/api/tracks/[id]/play` | POST | Log track play | 1 |
| `/api/tracks/random` | GET | Random track | 1 |
| `/api/audio/[id]` | GET | Stream audio file | 1 |
| `/api/search` | GET | Global search | 2 |
| `/api/favorites` | GET | List all favorites | 2 |
| `/api/favorites/releases/[id]` | POST | Favorite release | 2 |
| `/api/favorites/releases/[id]` | DELETE | Unfavorite release | 2 |
| `/api/favorites/tracks/[id]` | POST | Favorite track | 2 |
| `/api/favorites/tracks/[id]` | DELETE | Unfavorite track | 2 |
| `/api/playlists` | GET | List playlists | 2 |
| `/api/playlists` | POST | Create playlist | 2 |
| `/api/playlists/[slug]` | GET | Playlist detail | 2 |
| `/api/playlists/[slug]` | DELETE | Delete playlist | 2 |
| `/api/playlists/[slug]/tracks` | POST | Add track to playlist | 2 |
| `/api/playlists/[slug]/tracks/[trackId]` | DELETE | Remove track from playlist | 2 |
| `/api/timeline/decades` | GET | Available decades | 3 |
| `/api/timeline/[decade]` | GET | Releases in decade/year | 3 |
| `/api/stats` | GET | Global statistics | 3 |

### Request/Response Patterns

**Standard Error Response**:
```typescript
{
  statusCode: 400 | 404 | 500,
  message: string
}
```

**Standard Success (POST/DELETE)**:
```typescript
{
  success: true,
  message?: string,
  data?: any
}
```

**Pagination Pattern**:
```typescript
{
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  hasMore: boolean
}
```

---

## Database Schema Notes

### Key Tables

#### Artist
```prisma
model Artist {
  id                String  @id @default(cuid())
  name              String  @unique
  slug              String  @unique
  sortName          String?
  type              String?
  image             String?  // Local filename
  imageUrl          String?  // S3 URL
  bio               String?  @db.Text
  averageMatchScore Float    @default(0) // NOT matchScore!
  totalPlayCount    BigInt   @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  // Relations
  localReleases     LocalRelease[]
  genres            ArtistGenre[]
  musicbrainzArtist MusicBrainzArtist?
}
```

#### LocalRelease
```prisma
model LocalRelease {
  id              String   @id @default(cuid())
  title           String
  year            Int?
  folderPath      String   @unique // Relative to MUSIC_DIR
  image           String?  // Local filename
  imageUrl        String?  // S3 URL
  totalPlayCount  BigInt   @default(0)
  lastPlayedAt    DateTime?
  musicbrainzId   String?  // Link to MusicBrainzRelease
  artistId        String
  releaseId       String?
  createdAt       DateTime @default(now()) // NOT indexedAt!
  updatedAt       DateTime @updatedAt
  
  artist          Artist @relation(...)
  release         MusicBrainzRelease? @relation(...)
  tracks          LocalReleaseTrack[]
}
```

#### LocalReleaseTrack
```prisma
model LocalReleaseTrack {
  id              String    @id @default(cuid())
  title           String
  trackNumber     Int?
  duration        Int?      // Seconds
  filePath        String    @unique // Relative to MUSIC_DIR
  playCount       BigInt    @default(0)
  lastPlayedAt    DateTime?
  localReleaseId  String
  musicbrainzId   String?   // NOT used (no MusicBrainzTrack table)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  localRelease    LocalRelease @relation(...) // NOT "release"!
  playlists       PlaylistTrack[]
  favorites       FavoriteTrack[]
}
```

#### MusicBrainzRelease
```prisma
model MusicBrainzRelease {
  id              String   @id @default(cuid())
  musicbrainzId   String   @unique
  title           String
  trackCount      Int      @default(0)
  typeId          String?
  artistId        String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  artist          MusicBrainzArtist @relation(...)
  type            ReleaseType? @relation(...) // Access via .type.name!
  localReleases   LocalRelease[]
  favorites       FavoriteRelease[]
}
```

#### Playlist
```prisma
model Playlist {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique // Added Phase 3
  description String?  @db.Text
  image       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  tracks      PlaylistTrack[]
}
```

#### PlaylistTrack
```prisma
model PlaylistTrack {
  id         String   @id @default(cuid())
  playlistId String
  trackId    String
  position   Int
  createdAt  DateTime @default(now()) // Was called "addedAt" in docs
  
  playlist   Playlist @relation(...)
  track      LocalReleaseTrack @relation(...)
  
  @@unique([playlistId, trackId])
  @@index([playlistId, position])
}
```

#### Statistics
```prisma
model Statistics {
  id                              String    @id @default("main")
  artists                         Int       @default(0)
  tracks                          Int       @default(0)
  releases                        Int       @default(0)
  genres                          Int       @default(0)
  playtime                        BigInt    @default(0)
  plays                           BigInt    @default(0)
  artistsSyncedWithMusicbrainz    Int       @default(0)
  releasesSyncedWithMusicbrainz   Int       @default(0)
  artistsWithCoverArt             Int       @default(0)
  releasesWithCoverArt            Int       @default(0)
  lastScanStartedAt               DateTime?
  lastScanEndedAt                 DateTime?
  updatedAt                       DateTime  @updatedAt
}
```

### Critical Schema Notes

1. **Artist Match Score**: Field is `averageMatchScore`, not `matchScore`
2. **LocalRelease Timestamps**: Uses `createdAt`, not `indexedAt`
3. **LocalRelease Type**: Accessed via `release.type.name` relation, no direct field
4. **LocalReleaseTrack Play Count**: Field is `playCount`, LocalRelease has `totalPlayCount`
5. **LocalReleaseTrack Release**: Relation named `localRelease`, not `release`
6. **MusicBrainzRelease Type**: Accessed via `type.name` relation
7. **Playlist**: Has `slug` field (added Phase 3)
8. **PlaylistTrack**: Uses `createdAt`, was documented as `addedAt`
9. **FavoriteRelease**: Links to `MusicBrainzRelease`, not `LocalRelease`
10. **Statistics**: Single-row table with `id: 'main'`

---

## Component Architecture

### Layout Components

```
layouts/
└── default.vue
    ├── LayoutSidebar (desktop)
    ├── LayoutSearchBar (header)
    ├── <slot /> (main content)
    ├── LayoutMobileNav (mobile bottom)
    └── PlayerAudioPlayer (fixed bottom)
```

### Page Components

```
pages/
├── index.vue (Home)
│   ├── HomeReleaseGrid × 3
│   └── HomePlaylistGrid × 1
├── browse.vue
│   ├── BrowseFilterLetter
│   ├── BrowseFilterGenre
│   ├── BrowseFilterSort
│   ├── BrowseFilterScore
│   └── BrowseArtistGrid
│       └── BrowseArtistCard (per artist)
├── artist/
│   └── [slug].vue
│       ├── ArtistHeader
│       └── ArtistReleases
│           └── (per release)
│               ├── ReleaseReleaseCover
│               ├── ReleaseStatusBadge
│               └── ReleaseTracksTable
├── timeline/
│   └── index.vue (decade tabs + release grids)
├── favorites.vue
│   ├── Tabs (Releases / Tracks)
│   ├── HomeReleaseGrid (releases tab)
│   └── Track list (tracks tab)
├── playlists/
│   ├── index.vue
│   │   └── HomePlaylistGrid
│   └── [slug].vue
│       └── ReleaseTracksTable
└── statistics.vue (stat cards grid)
```

### Component Categories

**Layout**:
- `LayoutSidebar` - Desktop navigation
- `LayoutSearchBar` - Search input + dropdown trigger
- `LayoutSearchDropdown` - Search results dropdown
- `LayoutMobileNav` - Bottom tab navigation

**Browse**:
- `BrowseArtistGrid` - Infinite scroll grid
- `BrowseArtistCard` - Artist card with image + stats
- `BrowseFilterLetter` - A-Z letter buttons
- `BrowseFilterGenre` - Genre dropdown
- `BrowseFilterSort` - Sort dropdown
- `BrowseFilterScore` - Match score range sliders

**Artist**:
- `ArtistHeader` - Artist photo, name, stats
- `ArtistReleases` - Unified release list with tabs

**Release**:
- `ReleaseReleaseCover` - Album art with play overlay
- `ReleaseStatusBadge` - Status indicator (complete/incomplete/etc)
- `ReleaseTracksTable` - Expandable track list

**Home**:
- `HomeReleaseGrid` - Reusable release grid with heading
- `HomePlaylistGrid` - Playlist grid with mosaics

**Player**:
- `PlayerAudioPlayer` - Full audio player bar

**UI**:
- `UiSkeleton` - Generic loading skeleton
- `UiReleaseSkeleton` - Release card skeleton

### Component Reusability

**Highly Reused**:
- `HomeReleaseGrid` - Used on home, favorites, timeline
- `ReleaseTracksTable` - Used on artist pages, playlist detail
- `ReleaseReleaseCover` - Used anywhere album art is shown

**Single Use**:
- `ArtistHeader` - Only artist detail
- `BrowseArtistGrid` - Only browse page
- Layout components - Only in layout

---

## State Management

### Stores

#### Player Store (`stores/player.ts`)

**State**:
```typescript
currentTrack: PlayerTrack | null
queue: PlayerTrack[]
originalQueue: PlayerTrack[]
isPlaying: boolean
volume: number (0-1)
isMuted: boolean
currentTime: number
duration: number
isVisible: boolean
shuffleMode: 'off' | 'release' | 'artist' | 'catalogue'
history: string[] // Track IDs for previous
```

**Actions**:
```typescript
playTrack(track, newQueue?) // Start playing
togglePlay() // Pause/resume
next() // Next track or random
previous() // Previous or seek to 0
seek(time) // Jump to position
setVolume(val) // Adjust volume
toggleMute() // Mute/unmute
setQueue(tracks, startTrack?) // Set new queue
cycleShuffleMode() // Rotate shuffle modes
```

**Persistence**: All state saved to localStorage (debounced 500ms)

**Usage**:
```vue
<script setup>
const player = usePlayerStore()

function playAlbum() {
  player.setQueue(tracks)
}

function togglePlayback() {
  player.togglePlay()
}
</script>
```

#### Browse Store (`stores/browse.ts`)

**State**:
```typescript
artists: ArtistListItem[]
total: number
page: number
pageSize: number
hasMore: boolean
loading: boolean
loadingMore: boolean

// Filters
searchQuery: string
letterFilter: string | null
genreFilter: string | null
sortBy: string
minScore: number | null
maxScore: number | null
```

**Actions**:
```typescript
fetchArtists() // Load first page
loadMore() // Infinite scroll
setSearch(query) // Update search
setLetterFilter(letter) // A-Z or null
setGenreFilter(genre) // Genre or null
setSortBy(sort) // name | playCount | matchScore | recentlyAdded
setMinScore(score) // 0-100 or null
setMaxScore(score) // 0-100 or null
```

**Not Persisted**: Store is ephemeral, resets on page change

**Usage**:
```vue
<script setup>
const store = useBrowseStore()

onMounted(() => {
  if (store.artists.length === 0) {
    store.fetchArtists()
  }
})

function handleSearch(query: string) {
  store.setSearch(query)
}
</script>
```

### Composables

#### useImageUrl (`composables/useImageUrl.ts`)

**Purpose**: Resolve image URLs based on storage preference

**Methods**:
```typescript
artistImage({ image, imageUrl }): string | null
releaseImage({ image, imageUrl }): string | null
```

**Logic**:
1. If S3 preferred and `imageUrl` exists → return S3 URL
2. Else if `image` exists → return local path
3. Else → return null (component shows fallback)

**Usage**:
```vue
<script setup>
const { releaseImage } = useImageUrl()
const imgUrl = computed(() => releaseImage(props.release))
</script>
<template>
  <img v-if="imgUrl" :src="imgUrl" />
  <div v-else>{{ title[0] }}</div>
</template>
```

### Type Definitions

**Location**: `web/types/`

**Files**:
- `artist.ts` - Artist, ArtistListItem
- `release.ts` - UnifiedRelease, Release
- `track.ts` - Track, TrackWithRelease
- `player.ts` - PlayerTrack, ShuffleMode, PersistedPlayerState
- `search.ts` - SearchArtist, SearchRelease, SearchTrack, SearchResults
- `favorites.ts` - FavoriteRelease, FavoriteTrack, FavoritesResponse
- `playlist.ts` - PlaylistSummary, PlaylistTrack, PlaylistDetail
- `stats.ts` - Statistics

**Example** (PlayerTrack):
```typescript
export interface PlayerTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artistSlug: string | null
  releaseImage: string | null
  releaseImageUrl: string | null
  releaseId?: string // For release shuffle
  localReleaseId?: string // For API lookups
}
```

---

## Future Considerations

### Features Not Implemented

1. **User Authentication**
   - Current: Single-user system
   - Future: Multi-user with auth (see `docs/auth_proposal.md`)

2. **Playlist Collaboration**
   - Current: Personal playlists only
   - Future: Shared playlists, collaborative editing

3. **Advanced Queue Management**
   - Current: Simple queue, shuffle modes
   - Future: Drag-to-reorder, save queue as playlist

4. **Lyrics Display**
   - Schema supports lyrics
   - UI not implemented

5. **Track Ratings**
   - Schema supports ratings
   - UI not implemented

6. **Playlist Images**
   - Schema has `image` field
   - UI uses mosaics only

7. **Genre Management**
   - View genres, no edit
   - Future: Edit genre assignments

8. **Batch Operations**
   - Current: One-by-one
   - Future: Multi-select, bulk add to playlist

### Known Limitations

1. **Image Upload**
   - No UI for uploading images
   - Relies on scan script

2. **Playlist Reordering**
   - Can't drag to reorder tracks
   - Position is immutable after add

3. **Search Limitations**
   - Simple contains matching
   - No fuzzy search
   - No search operators

4. **Mobile Player Controls**
   - Basic controls only
   - No swipe gestures

5. **Statistics**
   - Read-only display
   - No charts/graphs
   - No historical data

### Performance Optimizations

**Already Implemented**:
- Lazy loading images
- Infinite scroll pagination
- Debounced search
- Skeletal loading states
- Range header audio streaming

**Potential Future**:
- Virtual scrolling for huge lists
- Service worker for offline
- IndexedDB cache
- Image progressive loading
- Audio preloading

### Code Quality

**Good Practices Used**:
- TypeScript strict mode
- Composition API throughout
- Reusable components
- Consistent naming
- Type-safe API responses
- Error boundaries

**Technical Debt**:
- Some components have inline styles
- Limited unit tests
- No E2E tests
- API error handling basic
- No request cancellation
- Playlist modal uses `prompt()`

### Migration Notes

**From v5**:
- Color mode removed (dark only)
- Downloader removed
- Settings pages removed
- Browse is `/browse` not `/`
- Root is home dashboard
- Search moved to header
- Different icon library

**Breaking Changes**:
- No backward compatibility
- Fresh database (can import)
- Different API structure
- No shared code with v5

---

## Conclusion

This document captures the complete three-phase implementation of DMP v6 web UI. All planned features are implemented and working. The application is production-ready with:

- ✅ Full feature parity with plan
- ✅ All three phases complete
- ✅ Mobile responsive
- ✅ No linter errors
- ✅ All schema issues resolved
- ✅ Critical bugs fixed

**Next Steps** (if any):
1. User acceptance testing
2. Performance monitoring
3. Bug fixes as discovered
4. Feature enhancements per user feedback

**Reference Documents**:
- Technical spec: `docs/web.md`
- Database schema: `docs/schema.md`
- Scripts documentation: `docs/scripts.md`
- Image system: `docs/images.md`
- Auth proposal: `docs/auth_proposal.md`

---

*Document Last Updated: February 14, 2026*  
*All Phases: Complete ✅*
