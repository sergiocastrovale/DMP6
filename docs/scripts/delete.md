# Scripts: delete

Permanently deletes an artist, their full catalogue (local + MB), images, and any co-artists whose entire catalogue falls within the deletion set.

## Usage

```bash
./delete "Radiohead"                # Delete single artist
./delete "Artist A;Artist B"        # Delete multiple (semicolon-separated)
./delete "Radiohead" --dry-run      # Preview without changes
./delete "Radiohead" --y            # Skip confirmation
```

## Cascade Rule

Co-artists are automatically deleted when ALL of their local releases AND MB releases are within the target's deletion set. Artists with any release outside the set are preserved.

## What Gets Deleted

- Artist row (cascades to ArtistUrl, junction tables, TrackArtist)
- All LocalRelease + LocalReleaseTrack rows
- All MusicBrainzRelease + MusicBrainzReleaseTrack rows
- Release + artist images (local + S3)
- FolderScan entries for deleted paths

## After Deleting

```bash
./index --only="Name" && ./sync --only="Name"   # Re-add if needed
```
