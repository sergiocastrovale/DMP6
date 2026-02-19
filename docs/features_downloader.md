# Soulseek Integration

Soulseek (slsk) is a peer-to-peer file sharing network focused on music. DMP v6 will integrate with slsk to download missing releases identified during the sync process.

## Status

🚧 **PLANNED** - Not yet implemented

## Planned Features

### 1. CLI Integration

Use `slskd` (Soulseek daemon) as the backend:
- API-based interaction
- Headless operation (no GUI required)
- Web UI for monitoring (optional)

### 2. Automated Downloads

- Identify `MISSING` releases from MusicBrainz sync
- Search slsk for matching releases
- Filter by quality (bitrate, format, file size)
- Queue downloads automatically
- Trigger re-indexing after download completion

### 3. Quality Filters

Configuration via `Settings` table:
- `slskAllowedFormats`: Comma-separated (e.g., `mp3,flac,opus`)
- `slskMinBitrate`: Minimum bitrate in kbps (e.g., `320`)
- `slskDownloadDir`: Target directory for downloads

### 4. Post-Processing

After download:
1. Run Beets to clean up metadata (see `docs/beets.md`)
2. Automatically trigger `./index` for new files
3. Re-sync artist to update status
4. Mark release as `COMPLETE` if all tracks found

## Installation (When Implemented)

### 1. Install slskd

```bash
# Ubuntu/Debian
wget https://github.com/slskd/slskd/releases/latest/download/slskd-linux-x64
chmod +x slskd-linux-x64
sudo mv slskd-linux-x64 /usr/local/bin/slskd
```

### 2. Configure slskd

Create config at `~/.config/slskd/slskd.yml`:

```yaml
soulseek:
  username: your_username
  password: your_password

downloads:
  dir: /path/to/downloads

web:
  port: 5030
  authentication:
    username: admin
    password: admin_password
```

### 3. Run slskd

```bash
# Start daemon
slskd

# Or as systemd service
sudo systemctl enable slskd
sudo systemctl start slskd
```

### 4. Configure DMP

Update `Settings` table via web UI:

```sql
UPDATE "Settings" SET
  "slskPath" = '/usr/local/bin/slskd',
  "slskUsername" = 'your_username',
  "slskPassword" = 'your_password',
  "slskDownloadDir" = '/path/to/downloads',
  "slskAllowedFormats" = 'mp3,flac',
  "slskMinBitrate" = 320
WHERE id = 'main';
```

## Usage (Planned)

### Automatic Mode

After running `./sync`, the web UI will show missing releases. Click "Download" to:
1. Search slsk for the release
2. Select best match (by bitrate, format, file count)
3. Queue download
4. Trigger post-processing on completion

### Manual Mode

Use the web UI to search and download any release:
1. Navigate to Artist → Releases
2. Click "Search Soulseek" for any release
3. Browse results, filter by quality
4. Select and download

### Batch Mode (CLI)

```bash
# Download all MISSING releases for an artist
./slsk --download --artist "Radiohead"

# Download specific release
./slsk --download --release "OK Computer"

# Search without downloading
./slsk --search --artist "Radiohead" --release "OK Computer"
```

## Integration Points

### 1. Database Schema

The `Settings` table already includes slsk fields:
- `slskPath`
- `slskUsername`
- `slskPassword`
- `slskDownloadDir`
- `slskAllowedFormats`
- `slskMinBitrate`

### 2. Web UI

Planned UI components:
- **Artist page**: "Download missing releases" button
- **Release detail**: "Download from Soulseek" button
- **Downloads page**: Active downloads, queue, history
- **Settings page**: Configure slsk credentials and filters

### 3. Workflow

```
Sync → Identify MISSING → Search slsk → Download → Beets cleanup → Re-index → Update status
```

## Security Considerations

- **Credentials**: Store slsk username/password securely (encrypt in DB)
- **API access**: Restrict slskd API to localhost or VPN
- **Legal**: Ensure compliance with local copyright laws

## References

- **slskd GitHub**: https://github.com/slskd/slskd
- **Soulseek network**: https://www.slsknet.org/
- **Soulseek protocol**: P2P, no central server

## See Also

- `docs/beets.md` - Metadata cleanup after downloads
- `docs/sync.md` - Identifying missing releases
