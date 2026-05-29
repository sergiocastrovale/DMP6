# SoulSync — Research Reference

DMP's download feature is based on research into [SoulSync](https://github.com/Nezreka/SoulSync), a Python/Flask music downloader with built-in support for seven sources.

## What DMP took from SoulSync

- **slskd REST API integration** — endpoint shapes, search polling, download monitoring, rate limiting pattern
- **Quality scoring heuristics** — format weight + bitrate + peer speed + queue penalty
- **Download orchestrator pattern** — source-agnostic facade with per-source routing

## What DMP skipped

- Deezer, HiFi, Tidal, Qobuz, YouTube (removed or never implemented)
- AcoustID fingerprinting (overkill for manual selection)
- Metadata enrichment workers (DMP has its own MusicBrainz sync)
- Post-download file organization (out of scope — DMP saves to `DOWNLOADS_PATH` and stops there)

## Source docs

- [Soulseek / slskd](downloads_slskd.md)
- [Overview](features_downloader.md)
