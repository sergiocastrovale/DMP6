# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DMP?

DMP (Disco Meu Primo) is a personal music library management web app combining Spotify, Plex, and Lidarr functionality. It scans a local music directory, matches tracks against MusicBrainz, and provides catalogue browsing, playback, listening parties, and analytics.

## Web App Commands

All web commands run from `web/`:

```bash
cd web
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm db:push      # Apply Prisma schema changes to DB
pnpm db:generate  # Regenerate Prisma client
pnpm db:studio    # Open Prisma Studio
```

## Scripts (Root Level)

Rust binaries compiled with `cargo build --release` and exposed as shell wrappers:

```bash
./index           # Scan MUSIC_DIR and index tracks into DB
./index --resume  # Resume interrupted index
./index --only="Artist Name" --overwrite  # Re-index specific artist
./sync            # Sync indexed artists against MusicBrainz
./sync --overwrite
./analysis        # Generate metadata quality report in /reports
./clean           # Process S3DeletionQueue, remove orphaned images
./clean --dry-run
./nuke            # Wipe entire DB and all images (destructive)
```

## Stack

- **Framework**: Nuxt 4.x + Vue 3 + TypeScript — all web code in `web/`
- **Styling**: Tailwind CSS v4 only — zero custom CSS
- **Icons**: `lucide-vue-next` only
- **State**: Pinia stores in `web/stores/` with manual localStorage persistence (not the plugin)
- **Database**: Prisma + PostgreSQL 16+; schema at `web/prisma/schema.prisma`
- **Scripts**: Rust (stable toolchain) — `index`, `sync`, `analysis`, `clean`, `nuke` are separate Cargo workspaces in `scripts/`
- **Real-time**: Nitro WebSockets (`web/server/routes/_ws.ts`) + mediasoup for Listening Party audio streaming

## Architecture

### Data Model

The core data model has two parallel trees joined by match status:

- **MusicBrainz tree**: `Artist → MusicBrainzRelease → MusicBrainzReleaseTrack` (canonical metadata from MusicBrainz)
- **Local tree**: `Artist → LocalRelease → LocalReleaseTrack` (actual files on disk)
- `LocalRelease.releaseId` links to `MusicBrainzRelease`, `LocalReleaseTrack.mbTrackId` links to `MusicBrainzReleaseTrack`
- `ReleaseStatus` enum tracks match quality: `COMPLETE | INCOMPLETE | EXTRA_TRACKS | MISSING | UNSYNCABLE | UNKNOWN`

### Image Handling

Controlled by `IMAGE_STORAGE` env (`local`, `s3`, or `both`):
- S3 path stored in `Artist.imageUrl` / `LocalRelease.imageUrl`
- Local path stored in `Artist.image` / `LocalRelease.image` (filename only, served from `web/public/img/`)
- Always use the `useImageUrl()` composable (`web/composables/useImageUrl.ts`) to resolve the correct URL — it prefers S3 when configured

### API Layer

Server API at `web/server/api/` follows Nuxt file-based routing:
- `artists/index.get.ts`, `artists/[slug].get.ts`, `artists/[slug]/tracks.get.ts`
- `releases/`, `tracks/`, `audio/`, `genres/`, `playlists/`, `favorites/`, `party/`, `search.get.ts`, `stats.get.ts`, `timeline/`
- All handlers import `prisma` from `~/server/utils/prisma` (singleton client)
- Use Prisma `select` to limit fields — avoid loading full records

### Listening Party

Real-time feature using mediasoup (WebRTC SFU):
- WebSocket handler: `web/server/routes/_ws.ts`
- Server-side session state: `web/server/utils/party.ts` (router, producer, consumers)
- Host composable: `web/composables/usePartyHost.ts`
- Listener composable: `web/composables/usePartyListener.ts`
- Configured via `PARTY_ENABLED`, `PARTY_ROLE`, `PARTY_URL`, `PARTY_SECRET`, `MEDIASOUP_ANNOUNCED_IP`, `RTC_MIN_PORT`/`RTC_MAX_PORT` env vars

### Player

`web/stores/player.ts` — manages HTML5 Audio, queue, shuffle modes, and history. Shuffle modes: `off | release | artist | catalogue`. Audio streamed from `/api/audio/[id]`. State manually persisted to `localStorage` under key `dmp-player`.

## Coding Standards

- TypeScript types live in `web/types/`
- No scripts-related or CLI invocation code in the web app
- All DB queries through Prisma — use `select` to limit fields, add indexes for filtered/sorted columns
- The `web/server/utils/prisma.ts` singleton must be the only Prisma client instantiation
