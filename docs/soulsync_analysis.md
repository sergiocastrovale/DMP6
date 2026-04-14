# SoulSync — Research Reference

DMP's download feature is based on research into [SoulSync](https://github.com/Nezreka/SoulSync), a Python/Flask music downloader with built-in support for seven sources.

## What DMP took from SoulSync

- **slskd REST API integration** — endpoint shapes, search polling, download monitoring, rate limiting pattern
- **Deezer gateway API + Blowfish decryption** — the trick for getting FLAC from a free Deezer account
- **HiFi public proxy API** — discovering that free lossless downloads exist without any account at all
- **Quality scoring heuristics** — format weight + bitrate + peer speed + queue penalty
- **Download orchestrator pattern** — source-agnostic facade with per-source routing

## What DMP skipped

- Tidal and Qobuz (paid subscription required — not worth it for a free-focused library)
- YouTube (not true high-quality audio, just transcoded from 128kbps source)
- AcoustID fingerprinting (overkill for manual selection)
- Metadata enrichment workers (DMP has its own MusicBrainz sync)
- Post-download file organization (out of scope — DMP saves to `DOWNLOADS_PATH` and stops there)

## Source-specific docs

For setup and usage, see:

- [Soulseek / slskd](downloads_slskd.md)
- [Deezer](downloads_deezer.md)
- [HiFi](downloads_hifi.md)
- [Overview](features_downloader.md)
