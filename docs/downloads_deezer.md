# Downloads — Deezer

Secondary download source in DMP. Reliable catalog, free account gives FLAC.

## What you get

- **Free** — a free Deezer account is enough
- **FLAC quality** — yes, even on the free tier (DMP uses Blowfish decryption to unlock lossless regardless of subscription)
- Large, reliable catalog — always on, no peer availability issues

## What you need

1. A free Deezer account — [sign up at deezer.com](https://www.deezer.com/register)
2. The **ARL token** from your browser cookies

## Getting the ARL token

1. Log in to [deezer.com](https://www.deezer.com)
2. Open browser DevTools (F12) → **Application** tab → **Cookies** → `https://www.deezer.com`
3. Find the cookie named `arl` and copy its value (a long alphanumeric string)

That value is your ARL token. Keep it private — it's effectively a login credential.

> **Note**: ARL tokens can expire if you log out or change password. If downloads stop working, refresh it.

## Configuring DMP

Set this in `.env`:

```
DEEZER_ARL=your-arl-token-here
DOWNLOADS_PATH=/path/to/downloads
```

Or set `deezerArl` in the Settings table — DB value overrides `.env` if both are set.

## Using it

On an artist page, missing releases show a download icon. Click it → pick **Deezer** → DMP finds the matching album on Deezer and downloads all tracks. Progress streams into the side panel. Files land in `DOWNLOADS_PATH/<artist>/<year> - <album>/` by default; customize via `DOWNLOAD_DIR_TEMPLATE` (see [features_downloader.md](features_downloader.md#where-files-go)).

For bulk downloads, use the "Download missing" button at the top of the releases list.

## How quality works

DMP tries quality levels in this order:

1. **FLAC** (lossless CD quality)
2. **MP3 320kbps**
3. **MP3 128kbps**

Whatever works first is what you get. With a valid ARL, FLAC almost always works.
