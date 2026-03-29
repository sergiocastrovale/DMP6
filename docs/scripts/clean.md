# Scripts: clean

Processes the `S3DeletionQueue` to remove orphaned images from S3 and local storage.

## Usage

```bash
./clean            # Delete queued images
./clean --dry-run  # Show what would be deleted
```

## How It Works

1. Fetches pending deletions from `S3DeletionQueue` table
2. Deletes from S3 and/or local storage (based on `IMAGE_STORAGE` env)
3. Removes processed items from queue

Images are queued automatically via DB triggers when artists or releases are deleted.

## Error Handling

- Errors logged to `errors.log` with `[timestamp][CLEAN]` prefix
- Non-fatal; failed items remain in queue for next run
