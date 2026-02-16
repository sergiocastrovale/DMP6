# Beets Integration

[Beets](https://beets.io/) is a music library management tool that automatically corrects and cleans up audio file metadata using MusicBrainz.

## Status

🚧 **PLANNED** - Not yet implemented

## Why Beets?

DMP v6 uses MusicBrainz for catalogue matching, but local files may have:
- Incorrect or missing tags
- Inconsistent naming conventions
- No MusicBrainz IDs
- Poor quality metadata from different tagging tools

**Beets solves this** by:
1. Analyzing audio fingerprints (AcoustID)
2. Matching against MusicBrainz
3. Rewriting tags with canonical data
4. Adding MusicBrainz IDs to files
5. Organizing files by consistent naming

## Planned Workflow

```
Download from Soulseek → Run Beets → Re-index → Sync with MusicBrainz
```

### Integration Points

1. **After Soulseek downloads**: Automatically run Beets on new files
2. **Manual cleanup**: Web UI button to "Fix metadata" for any release
3. **Batch mode**: CLI command to process entire library
4. **Trigger re-index**: Automatically mark files as needing re-scan after Beets

## Installation (When Implemented)

### 1. Install Beets

```bash
# Ubuntu/Debian
sudo apt install beets

# Or via pip
pip install beets
```

### 2. Install Plugins

```bash
pip install pyacoustid  # For audio fingerprinting
```

### 3. Configure Beets

Create config at `~/.config/beets/config.yaml`:

```yaml
# -------------------------
# Library
# -------------------------
directory: /mnt/c/__TEST
library: ~/.config/beets/library.db
pluginpath: ~/.config/beets

artresizer:
  method: imagemagick
  convert_cmd: /usr/bin/convert
  identify_cmd: /usr/bin/identify

# -------------------------
# Plugins
# -------------------------
plugins:
  - chroma
  - fetchart
  - embedart
  - lastgenre
  - discogs
  - fromfilename
  - replaygain
  - scrub
  - zero
  - info
# custom plugin
  - bandcamp

# -------------------------
# Import behavior
# -------------------------
import:
  write: yes
  move: no
  copy: no
  link: no
  autotag: yes
  resume: yes
  incremental: no
  quiet: yes
  log: ~/.config/beets/import.log

# -------------------------
# Matching (high accuracy)
# -------------------------
match:
  strong_rec_thresh: 0.15
  medium_rec_thresh: 0.25

  preferred:
    countries: [US, GB, JP, XW]
    media: [CD, Digital Media, Vinyl]
    original_year: yes

  ignored_media:
    - Cassette

  # Avoid low-quality releases
  ignored:
    - various artists
    - soundtrack

  distance_weights:
    source: 0.5
    year: 0.2
    country: 0.1
    media: 0.1
    label: 0.1

# -------------------------
# AcoustID (fingerprinting)
# -------------------------
acoustid:
  apikey: 8H40oaNghz

chroma:
  auto: yes

# -------------------------
# Artwork download
# -------------------------
fetchart:
  auto: yes
  cautious: yes
  minwidth: 600
  maxwidth: 2000
  enforce_ratio: yes
  cover_names: cover
  sources:
    - coverart
    - itunes
    - amazon
  store_source: yes

# -------------------------
# Artwork embed + resize
# -------------------------
embedart:
  auto: yes
  ifempty: no
  maxwidth: 1000
  quality: 70
  compare_threshold: 10

# Save cover file as cover.jpg
art_filename: cover

# -------------------------
# Genre tagging
# -------------------------
lastgenre:
  auto: no
  source: album
  count: 3
  separator: "; "
  force: no

# -------------------------
# Discogs metadata
# -------------------------
discogs:
  data_source_mismatch_penalty: 0.2
  user_token: IoFzopHCSMXENSxLducwIKfUlbVhzXAoEgqvbckq
  append_style_genre: yes
  index_tracks: yes

# Custom fields

item_fields:
  DISCOGS_TRACKID: discogs_track_id
  BANDCAMP_URL: bandcamp_url

album_fields:
  DISCOGS_ALBUMID: discogs_albumid
  DISCOGS_ARTISTID: discogs_artistid
  DISCOGS_LABEL_ID: discogs_labelid
  DISCOGS_URL: |
    https://www.discogs.com/release/$discogs_albumid


# -------------------------
# ReplayGain (volume normalization)
# -------------------------
replaygain:
  auto: yes
  backend: ffmpeg

# -------------------------
# Clean tags
# -------------------------
scrub:
  auto: yes

zero:
  fields:
    - comments
    - lyrics

# -------------------------
# File naming
# -------------------------
paths:
  default: $albumartist/$album%aunique{}/$track - $title
  singleton: Non-Album/$artist - $title


# -------------------------
# UI
# -------------------------
ui:
  color: yes
```

## Usage (Planned)

### Automatic Mode (Post-Download)

After Soulseek downloads complete:
1. Beets runs automatically in background
2. Progress shown in web UI notifications
3. Files are tagged with MusicBrainz IDs
4. Indexer re-scans the files
5. Sync updates the database

### Manual Mode (Web UI)

For any release in the web UI:
1. Click "Fix metadata" button
2. Beets analyzes the files
3. Shows proposed changes
4. User confirms or skips
5. Tags are written
6. Re-index is triggered

### CLI Mode

```bash
# Import and tag a single directory
beet import /path/to/new/album

# Import without confirmation
beet import -q /path/to/new/album

# Re-tag existing files
beet import -L /path/to/existing/album

# Update metadata for entire library
beet update

# Check for missing MusicBrainz IDs
beet ls -f '$artist - $album - $title' mb_trackid::^$
```

## Beets Plugins

### Essential Plugins

| Plugin | Purpose |
|--------|---------|
| `chroma` | AcoustID fingerprinting for accurate matching |
| `fetchart` | Download album artwork |
| `embedart` | Embed artwork into files |
| `lastgenre` | Fetch genres from Last.fm |
| `scrub` | Remove unnecessary tags |
| `duplicates` | Find duplicate files |
| `missing` | Find missing tracks in releases |

### Optional Plugins

| Plugin | Purpose |
|--------|---------|
| `replaygain` | Calculate ReplayGain values |
| `lyrics` | Fetch song lyrics |
| `discogs` | Match with Discogs (alternative to MB) |
| `bandcamp` | Import from Bandcamp purchases |

## Integration with DMP Scripts

### 1. Post-Download Hook

When Soulseek download completes:

```rust
// In future slsk integration script
async fn post_download(download_dir: &Path) -> Result<()> {
    // 1. Run Beets
    Command::new("beet")
        .args(&["import", "-q", download_dir.to_str().unwrap()])
        .status()?;
    
    // 2. Trigger re-index
    Command::new("./index")
        .arg(download_dir.to_str().unwrap())
        .status()?;
    
    // 3. Re-sync artist
    let artist = extract_artist_from_path(download_dir)?;
    Command::new("./sync")
        .args(&["--only", &artist])
        .status()?;
    
    Ok(())
}
```

### 2. Manual Cleanup

Web UI triggers Beets for specific release:

```typescript
// In future web API endpoint
async function fixMetadata(releaseId: string) {
  const release = await db.localRelease.findUnique({
    where: { id: releaseId },
    include: { tracks: true }
  });
  
  const folderPath = path.join(MUSIC_DIR, release.folderPath);
  
  // Run Beets on the folder
  await exec(`beet import -q "${folderPath}"`);
  
  // Mark for re-indexing
  await markForReindex(folderPath);
  
  return { success: true, message: "Metadata cleanup queued" };
}
```

## Benefits for DMP

1. **Better matching**: MusicBrainz IDs in files = 100% accurate sync
2. **Consistent tags**: No more "Rock", "rock", "ROCK" genre variations
3. **Cover art**: Automatically fetches and embeds high-quality artwork
4. **Missing track detection**: Beets warns if an album is incomplete
5. **Quality control**: Validates file integrity and metadata completeness

## Workflow Examples

### Example 1: New Download from Slsk

```
1. User clicks "Download" for Radiohead - OK Computer
2. Slsk downloads 12 tracks to /downloads/radiohead/
3. Beets runs: beet import -q /downloads/radiohead/
4. Beets matches with MusicBrainz, adds IDs to files
5. Indexer re-scans: ./index /downloads/radiohead/
6. Sync updates: ./sync --only="Radiohead"
7. Status changes from MISSING → COMPLETE
```

### Example 2: Fixing Existing Files

```
1. User notices "Unknown Album" with bad tags
2. Clicks "Fix metadata" in web UI
3. Beets analyzes files using audio fingerprints
4. Proposes match: "OK Computer (1997)" by Radiohead
5. User confirms
6. Beets rewrites all tags + embeds cover art
7. Auto re-index updates database
8. Album now properly matched with MusicBrainz
```

## Error Handling

Beets may fail to match files if:
- Audio quality is very poor
- Files are corrupted
- Release is very obscure (not in MusicBrainz)
- Fingerprinting fails

**DMP should:**
- Log Beets errors to `errors.log`
- Mark files as "needs manual review" in DB
- Provide web UI to manually search MusicBrainz
- Allow users to skip or force-match problematic releases

## See Also

- **Beets documentation**: https://beets.readthedocs.io/
- **AcoustID**: https://acoustid.org/
- **MusicBrainz Picard**: Alternative GUI tool (not used by DMP)
- `docs/slsk.md` - Integration with Soulseek downloads
- `docs/sync.md` - MusicBrainz synchronization

## Future Enhancements

1. **Beets API**: Use beets as a library instead of CLI
2. **Custom plugins**: Write DMP-specific Beets plugins
3. **Batch processing**: Queue large import jobs
4. **Conflict resolution**: UI for reviewing ambiguous matches
5. **Statistics**: Track Beets success rate per source (Slsk vs manual)
