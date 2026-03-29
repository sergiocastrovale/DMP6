# Scripts: nuke

Wipes all database tables and image files. **Destructive** — no confirmation prompt.

## Usage

```bash
./nuke
```

## What It Does

1. Truncates all database tables (cascading)
2. Deletes local image files (`web/public/img/`)
3. Deletes S3 images (if `IMAGE_STORAGE=s3` or `both`)
