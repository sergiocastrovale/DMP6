# Scripts: nuke

Completely deletes all database tables and image files. **Destructive operation** - use with caution!

### Usage

```bash
./nuke
```

### What it does

1. Truncates all database tables

2. Deletes local image files

3. Deletes S3 images (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`)

### Error Handling

- Errors are logged to `errors.log` with `[NUKE]` prefix
- Non-fatal: continues with next operation even if one fails
- Provides detailed error messages (e.g., S3 connection failures, DB errors)