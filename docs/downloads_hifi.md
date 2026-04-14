# Downloads — HiFi

Third download source in DMP. Completely free lossless downloads via public proxy instances.

## What you get

- **Completely free** — no account, no login, no subscription
- **FLAC lossless** — CD quality, always
- Fast downloads — direct CDN streams, no P2P waiting

## What you need

Nothing. Zero configuration.

## Configuring DMP

There's nothing to set up. As long as `DOWNLOADS_PATH` is configured, HiFi is ready to use.

```
DOWNLOADS_PATH=/path/to/downloads
```

## Using it

HiFi is the **default source** in the download dialog when available — click the download icon on a missing release, pick **HiFi**, and DMP finds + downloads the album. Progress streams into the side panel. Files land in `DOWNLOADS_PATH/<artist>/<year> - <album>/` by default; customize via `DOWNLOAD_DIR_TEMPLATE` (see [features_downloader.md](features_downloader.md#where-files-go)).

For bulk downloads, use the "Download missing" button at the top of the releases list.

## The catch

HiFi downloads go through a rotating list of public proxy instances (maintained by volunteers). DMP automatically rotates through them if one is down, but:

- **Instances can disappear** — if all of them go offline, HiFi stops working until new ones come up
- **No SLA** — it's free; reliability varies
- **Not every track is findable** — the catalog overlaps with Tidal/Qobuz, but not everything is there

For these reasons HiFi is great as a first try, but you should still have Soulseek or Deezer configured as a backup.
