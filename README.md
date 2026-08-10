# DMP v6

## What is DMP?

DMP is a web app which combines Spotify, Plex and Lidarr, along with other archival-centric features.

Working conventions, data model and the day-to-day command reference live in [CLAUDE.md](CLAUDE.md).

## Features

* [Catalogue management](docs/features_catalogue.md)
* [Tagging](docs/features_tagging.md)
* [Downloader](docs/features_downloader.md) — [Soulseek/slskd](docs/downloads_slskd.md), [RuTracker](docs/feature_rutracker.md), [monitoring](docs/feature_monitoring.md)
* [Explore](docs/feature_explore.md)
* [Generated playlists](docs/feature_generated_playlists.md)
* [PWA](docs/pwa_overview.md) — [setup](docs/pwa_setup.md), [service worker](docs/pwa_serviceworker.md), [networking](docs/pwa_networking.md), [media session](docs/pwa_mediasession.md), [Android/Capacitor](docs/pwa_capacitor_android.md), [testing](docs/pwa_testing.md)

## Setup

* [Local setup](docs/setup_local.md)
* [TrueNAS deployment](docs/truenas.md)
* [Deploy script](docs/deploy.md)

## Development

* [Dev guide](docs/dev_guide.md)
* [DB schema](docs/schema.md)
* [Handling images](docs/images.md)
* [Redis cache](docs/redis.md)
* [Post-sync routine](docs/post_sync.md)
* [Ideas and future features](docs/future.md)

## Scripts

Overview: [scripts/README.md](scripts/README.md).

* [index](docs/scripts/index.md) · [sync](docs/scripts/sync.md) · [refresh](docs/scripts/refresh.md)
* [audit](docs/scripts/audit.md) · [fix](docs/scripts/fix.md) · [problems](docs/scripts/problems.md)
* [analysis](docs/scripts/analysis.md) · [dissect](docs/scripts/dissect.md) · [extract-meta-images](docs/scripts/extract-meta-images.md)
* [playlists](docs/scripts/playlists.md) · [mosaic](docs/scripts/mosaic.md)
* [delete](docs/scripts/delete.md) · [nuke](docs/scripts/nuke.md) · [backup & restore](docs/scripts/backup.md)
