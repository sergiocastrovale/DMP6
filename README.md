# DMP v6

## What is DMP?

DMP is a web app which combines Spotify, Plex and Lidarr, along with other archival-centric features.

Working conventions, data model and the day-to-day command reference live in [CLAUDE.md](CLAUDE.md).

## Table of contents

- [Features overview](#features-overview)
- [Documentation](#documentation)
  - [Features](#features)
  - [PWA](#pwa)
  - [Setup & deployment](#setup--deployment)
  - [Development](#development)
  - [Scripts](#scripts)

## Features overview

- **Catalogue** — local audio files matched against MusicBrainz into a dual tree (local files ↔
  canonical MB releases). Drives artist/release browsing, completeness status
  (COMPLETE/MISSING_TRACKS/etc.), box-set handling, and everything else below.
- **Player** — persistent bottom player bar with 5 shuffle modes (off, release, artist, catalogue,
  explorer). Queue and playback state survive a reload.
- **Explore** — 4-slider (energy/era/familiarity/sound) discovery mode that picks tracks by score
  rather than a queue; doubles as a now-playing/visualizer surface.
- **Playlists + generated playlists** — manual playlists, plus auto-generated genre and region
  playlists rebuilt from the catalogue's tags/metadata.
- **Favorites** — per-track and per-release favoriting, browsable in a dedicated tabbed view.
- **Downloader** — Soulseek (slskd)-backed acquisition pipeline that fills catalogue gaps
  (MISSING releases), with a queue/merge/approval flow and optional tag enrichment (SongKong) and
  artist monitoring for new releases.
- **Labs** — experimental visualizations over the catalogue: world map by artist origin, genre/
  artist relationship graphs, decade stats, and mosaic image generation.

## Documentation

### Features

* [Tagging](docs/features_tagging.md)
* [Downloads](docs/downloader/downloads.md) — [Soulseek/slskd](docs/downloader/downloads_slskd.md), [tag enrichment](docs/downloader/downloads_songkong.md), [monitoring](docs/feature_monitoring.md)
* [Explore](docs/feature_explore.md)
* [Generated playlists](docs/feature_generated_playlists.md)
* [Visualizer](docs/feature_visualizer.md)

### PWA

* [Overview](docs/pwa/pwa_overview.md)
* [Setup](docs/pwa/pwa_setup.md)
* [Service worker](docs/pwa/pwa_serviceworker.md)
* [Networking](docs/pwa/pwa_networking.md)
* [Media session](docs/pwa/pwa_mediasession.md)
* [Android/Capacitor](docs/pwa/pwa_capacitor_android.md)
* [Testing](docs/pwa/pwa_testing.md)

### Setup & deployment

* [TrueNAS deployment](docs/truenas.md)
* [Deploy script](docs/deploy.md)

### Development

* [Dev guide](docs/dev_guide.md)
* [Design system](docs/design_system.md)
* [Multi-disk / box sets](docs/sync_decisions.md)
* [Handling images](docs/images.md)
* [Redis cache](docs/redis.md)
* [Post-sync routine](docs/post_sync.md)
* [Ideas and future features](docs/future.md)

### Scripts

Overview: [scripts/README.md](scripts/README.md).

* [index](docs/scripts/index.md) · [sync](docs/scripts/sync.md) · [tidy](docs/scripts/tidy.md) · [refresh](docs/scripts/refresh.md) · [add](docs/scripts/add.md)
* [audit](docs/scripts/audit.md) · [fix](docs/scripts/fix.md) · [problems](docs/scripts/problems.md)
* [analysis](docs/scripts/analysis.md) · [dissect](docs/scripts/dissect.md) · [extract-meta-images](docs/scripts/extract-meta-images.md)
* [playlists](docs/scripts/playlists.md) · [mosaic](docs/scripts/mosaic.md) · [artist-photos](docs/scripts/artist-photos.md)
* [delete](docs/scripts/delete.md) · [nuke](docs/scripts/nuke.md) · [backup & restore](docs/scripts/backup.md)
