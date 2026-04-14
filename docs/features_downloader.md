# Downloads

DMP can download missing releases directly from the artist page. Three free sources are supported:

| Source | Setup | Cost | Quality |
|--------|-------|------|---------|
| [HiFi](downloads_hifi.md) | None | Free, no account | FLAC |
| [Soulseek](downloads_slskd.md) | Run slskd daemon | Free account | Depends on peers |
| [Deezer](downloads_deezer.md) | Get ARL token | Free account | FLAC |

## How it works

Each release on an artist page that isn't in your library shows a download icon. Clicking it opens a dialog where you pick a source and review results. A second button at the top — "Download missing" — lets you grab every missing release in the current view in one go.

Downloads run in the background and show live progress in the side panel (same one used by the Sync command).

## Where files go

All sources save to `DOWNLOADS_PATH`, nested inside a folder derived from `DOWNLOAD_DIR_TEMPLATE`. The default template is `{artist}/{year} - {album}`, so a download lands as:

```
DOWNLOADS_PATH/
└── Radiohead/
    └── 2007 - In Rainbows/
        ├── 01 - 15 Step.flac
        └── ...
```

HiFi and Deezer write directly into this folder. Soulseek is different — slskd owns its downloads directory, so DMP waits for each transfer to complete and then **moves** the files into the templated folder. This assumes slskd's download directory is reachable under `DOWNLOADS_PATH` (in the default docker-compose setup both containers share `/downloads`). If slskd stores files on a volume DMP can't see, the move step silently no-ops and files stay where slskd put them.

DMP does **not** automatically move anything into your music library — that's a manual step:

1. Download lands in `DOWNLOADS_PATH/<templated folder>`
2. You move it into `MUSIC_DIR` (with proper folder structure)
3. Run `./sync --only "Artist Name"` to pick it up

## Settings

Everything is configurable in both `.env` and the Settings DB table. DB values win when both are set.

Shared config:

```
DOWNLOADS_PATH=/path/to/downloads
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'  # folder layout
DOWNLOAD_FORMATS=flac,mp3                         # what to accept
DOWNLOAD_MIN_BITRATE=320                          # kbps minimum
```

`DOWNLOAD_DIR_TEMPLATE` placeholders:

| Placeholder | Substituted with |
|-------------|------------------|
| `{artist}`  | Release's primary artist |
| `{album}`   | Release title |
| `{year}`    | Release year (omitted with surrounding ` - ` padding if unknown) |

Forward slashes in the template create nested folders. Each segment is sanitized independently so slashes inside titles don't escape the intended structure.

Source-specific config is in each source's doc.

## Recommendation

Enable all three. They complement each other:

- **HiFi** first — free, lossless, fast
- **Soulseek** as fallback — huge catalog, anything obscure
- **Deezer** for mainstream releases HiFi can't find
