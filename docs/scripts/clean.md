# Scripts: clean

Processes the `S3DeletionQueue` to remove orphaned images from S3 and local storage.

### Usage

```bash
# Normal mode - delete queued images
./clean

# Dry run - show what would be deleted without actually deleting
./clean --dry-run
```

### What it does

1. Fetches pending deletions from `S3DeletionQueue` table
2. For each queued item:
   - Deletes from S3 (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`)
   - Deletes from local storage (if `IMAGE_STORAGE=local` or `IMAGE_STORAGE=both`)
   - Removes item from queue on success

### How items get queued

Images are automatically queued for deletion via database triggers:

**Artist deletion trigger:**
```sql
CREATE TRIGGER trigger_queue_artist_image_deletion
BEFORE DELETE ON "Artist"
FOR EACH ROW
EXECUTE FUNCTION queue_artist_image_deletion();
```

**Release deletion trigger:**
```sql
CREATE TRIGGER trigger_queue_release_image_deletion
BEFORE DELETE ON "LocalRelease"
FOR EACH ROW
EXECUTE FUNCTION queue_release_image_deletion();
```

These triggers fire when:
- Individual artists/releases are deleted
- The `./nuke` script truncates tables (bulk deletion)
- Foreign key cascades delete related records

### CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be deleted without actually deleting |

### Error Handling

- Errors are logged to `errors.log` with `[CLEAN]` prefix
- Non-fatal: continues with next item even if one fails
- Failed deletions remain in queue for retry on next run

### Automation

For production, we can run the clean script periodically via cron:

```bash
# Add to crontab (run every 6 hours)
0 */6 * * * cd /path/to/DMPv6 && ./clean >> logs/clean.log 2>&1