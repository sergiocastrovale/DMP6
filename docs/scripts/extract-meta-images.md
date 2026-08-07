# Scripts: extract-meta-images

Walks the music library and, for every release that has no cover image file on disk, extracts the embedded cover art from the release's first audio file and writes it as `folder.jpg` at the release root. Read-mostly: the only thing ever written is a new `folder.jpg` in a release that had none. Existing images are never overwritten and audio files are never touched.

## Build

```bash
cd scripts && cargo build --release -p extract-meta-images
```

## Usage

```bash
./extract-meta-images                          # Normalize the whole library
./extract-meta-images --dry-run                # Preview, write nothing
./extract-meta-images --only "Radiohead"       # One artist (prefix match)
./extract-meta-images --only "Air" --exact     # One artist, exact name
./extract-meta-images --from e --to fz         # Artist range
./extract-meta-images --root /mnt/music        # Override MUSIC_DIR
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--root` | String | `MUSIC_DIR` from `web/.env` | Library root |
| `--only` / `-o` | String | - | Only these artists, semicolon-separated |
| `--from` / `-f` | String | - | Start of artist range |
| `--to` / `-t` | String | - | End of artist range |
| `--exact` | bool | false | Exact match for `--only` (no prefix matching) |
| `--dry-run` | bool | false | Preview without writing |
| `--web` | bool | false | Machine-readable progress output |

Needs no database - it reads `MUSIC_DIR` from `web/.env` and touches nothing else.

## How It Works

Per release folder (disc subfolders like `CD1`/`CD2` collapse into their parent, matching how `index` groups a multi-disc set as one release):

1. A `cover`/`folder`/`front` `.jpg`/`.jpeg`/`.png` at the release root → **skip**, already normalized.
2. Otherwise take the first available cover candidate, in this order:
   - the release root's first audio file's embedded picture;
   - if the root has no direct audio files (a disc-split layout), the first subfolder's cover file, then that subfolder's first audio file's embedded picture.

   No candidate → skip. Audio files 2, 3, … and second/third subfolders are never scanned.
3. Fit the image inside 500x500 preserving aspect ratio (never upscaled), encode JPEG at quality 80, write to `<release>/folder.jpg`.

The candidate ordering is `common::images::release_cover_candidates` - the same function `index` resolves covers with, so the two cannot drift.

Writes go to a temp file and are renamed into place. An interrupted run must never leave a truncated `folder.jpg` behind, since step 1 would then treat it as a valid cover forever after.

## Why

`index` resolves a release's cover by checking for an external image file **first**, and only then probing an audio file's tags. A tag probe is far more expensive than opening a JPEG, so every release carrying a real `folder.jpg` is one fewer audio file the indexer has to parse. Running this once over the library shifts nearly every release onto the cheap path.

See the cover-resolution section of [index.md](index.md) for the indexer side.

## Summary Output

| Line | Meaning |
|---|---|
| `Releases` | Release folders scanned |
| `Had cover` | Skipped - a cover file already sat at the release root |
| `Written` | `folder.jpg` created (`Would write` under `--dry-run`) |
| `No art` | Neither a cover file nor an extractable embedded picture |
| `Failed` | Encode or write error (also logged to `errors.log`) |

## After Running

```bash
./index --only "Name" --overwrite-with-images   # Re-extract thumbnails from the new folder.jpg
```

The music library is not mounted locally - a real run happens on the NAS, so `./deploy` first.
