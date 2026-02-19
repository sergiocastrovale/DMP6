# DMP Scripts

This directory contains Rust-based utility scripts for managing the DMP music library.

## Configuration

All scripts read configuration from `web/.env`. **No hardcoded paths or URLs should exist in the scripts.**

### Required Environment Variables

Copy `web/.env.example` to `web/.env` and configure:

```bash
# Base configuration
MUSIC_DIR=/path/to/your/music/library
DATABASE_URL=postgresql://dmp6:dmp6@localhost:5432/dmp6
PROJECT_ROOT=/absolute/path/to/DMPv6

# Image storage (local, s3, or both)
IMAGE_STORAGE=local

# S3 configuration (if using S3)
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=
S3_PUBLIC_URL=https://your-bucket.s3.region.amazonaws.com
```

### How Configuration Loading Works

Each script tries to load `.env` in this order:

1. `web/.env` (relative to current directory)
2. `../../web/.env` (if running from scripts/[name])
3. `$PROJECT_ROOT/web/.env` (if PROJECT_ROOT env var is set)
4. Auto-detect from current directory structure

**Best Practice**: Set `PROJECT_ROOT` in your `.env` file to ensure scripts work from any directory.

## Available Scripts

### 1. `index` - Index Local Music Files

Scans your music directory and indexes all audio files into the database.

```bash
cd scripts/index
cargo run --release [OPTIONS] [MUSIC_DIR]

# Examples:
cargo run --release                          # Use MUSIC_DIR from .env
cargo run --release /path/to/music          # Override MUSIC_DIR
cargo run --release -- --only a             # Only index artists starting with 'a'
cargo run --release -- --from a --to m      # Index artists from a to m
cargo run --release -- --overwrite          # Re-index everything
cargo run --release -- --resume             # Resume from last checkpoint
cargo run --release -- --skip-images        # Don't extract cover art
cargo run --release -- --threads 8          # Use 8 threads (default: all cores)
cargo run --release -- --limit 1000         # Only process first 1000 files
```

**Options:**
- `--overwrite` - Delete existing data and re-index
- `--from <prefix>` - Start from artists beginning with prefix
- `--to <prefix>` - Stop at artists ending with prefix
- `--only <prefix>` - Only index artists starting with prefix
- `--resume` - Continue from last checkpoint
- `--skip-images` - Skip cover art extraction
- `--threads <n>` - Number of parallel workers (0 = all cores)
- `--limit <n>` - Limit to first N files (0 = no limit)

### 2. `sync` - Sync with MusicBrainz

Fetches metadata from MusicBrainz for artists in your library.

```bash
cd scripts/sync
cargo run --release [OPTIONS]

# Examples:
cargo run --release                          # Sync new artists only
cargo run --release -- --overwrite          # Re-sync all artists
cargo run --release -- --only a             # Only sync artists starting with 'a'
cargo run --release -- --from a --to m      # Sync artists from a to m
cargo run --release -- --limit 10           # Only sync first 10 artists
```

**Options:**
- `--overwrite` - Re-sync all artists (including already synced)
- `--only <prefix>` - Only sync artists starting with prefix
- `--from <prefix>` - Sync artists starting from prefix
- `--to <prefix>` - Sync artists up to and including prefix
- `--limit <n>` - Limit to first N artists

**Note:** MusicBrainz has rate limits. Large syncs may take time.

### 3. `clean` - Clean Orphaned Images

Removes image files that are no longer referenced in the database.

```bash
cd scripts/clean
cargo run --release [OPTIONS]

# Examples:
cargo run --release                          # Clean orphaned images
cargo run --release -- --dry-run            # Show what would be deleted
```

**Options:**
- `--dry-run` - Show what would be deleted without actually deleting

### 4. `nuke` - Delete All Data

**⚠️ DANGER:** Deletes all data from the database and all image files.

```bash
cd scripts/nuke
cargo run --release [OPTIONS]

# Examples:
cargo run --release                          # Interactive confirmation
cargo run --release -- --yes                # Skip confirmation (dangerous!)
```

**Options:**
- `--yes` - Skip confirmation prompt

## Building Scripts

Each script can be built independently:

```bash
cd scripts/[script-name]
cargo build --release
```

The compiled binary will be in `target/release/dmp-[script-name]`.

## Development

### Adding New Scripts

When creating new scripts:

1. **Never hardcode paths or URLs** - use environment variables
2. Load configuration from `.env` using the standard pattern
3. Use `PROJECT_ROOT` to construct absolute paths to project resources
4. Support both relative and absolute path resolution
5. Add colored output for better UX (use the `colored` crate)
6. Include progress indicators for long-running operations
7. Write errors to `errors.log`

### Standard Configuration Pattern

```rust
use dotenvy;
use std::path::PathBuf;

struct Config {
    database_url: String,
    project_root: String,
    // ... other fields
}

fn load_config() -> Config {
    // Try relative paths first
    let env_paths = [
        PathBuf::from("web/.env"),
        PathBuf::from("../../web/.env"),
    ];

    let mut env_loaded = false;
    for p in &env_paths {
        if p.exists() {
            dotenvy::from_path(p).ok();
            env_loaded = true;
            break;
        }
    }

    // Fallback to PROJECT_ROOT
    if !env_loaded {
        if let Ok(project_root) = std::env::var("PROJECT_ROOT") {
            let env_path = PathBuf::from(&project_root).join("web/.env");
            if env_path.exists() {
                dotenvy::from_path(env_path).ok();
            }
        }
    }

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL not set in web/.env");
    
    let project_root = std::env::var("PROJECT_ROOT")
        .unwrap_or_else(|_| {
            // Auto-detect from current directory
            std::env::current_dir()
                .ok()
                .and_then(|d| {
                    if d.ends_with("scripts/yourscript") {
                        d.parent().and_then(|p| p.parent())
                            .map(|p| p.to_string_lossy().to_string())
                    } else if d.ends_with("scripts") {
                        d.parent().map(|p| p.to_string_lossy().to_string())
                    } else {
                        Some(d.to_string_lossy().to_string())
                    }
                })
                .unwrap_or_else(|| ".".to_string())
        });

    Config {
        database_url,
        project_root,
    }
}
```

### Using PROJECT_ROOT

Always construct paths using `project_root`:

```rust
// Good ✓
let img_dir = PathBuf::from(&config.project_root)
    .join("web/public/img/releases");

// Bad ✗
let img_dir = PathBuf::from("/home/kp/web/DMPv6/web/public/img/releases");
```

## Troubleshooting

### "DATABASE_URL not set"
- Ensure `web/.env` exists and contains `DATABASE_URL`
- Check that you're running from the correct directory
- Set `PROJECT_ROOT` environment variable

### "No such file or directory" for images
- Verify `PROJECT_ROOT` is set correctly in `.env`
- Check that `web/public/img/` directories exist
- Run from project root or set `PROJECT_ROOT` env var

### MusicBrainz rate limiting
- The sync script has built-in rate limiting
- For large libraries, run in batches using `--from` and `--to`
- Consider running overnight for full syncs

### S3 upload failures
- Verify S3 credentials are correct
- Check bucket permissions
- Ensure `S3_PUBLIC_URL` matches your bucket configuration

## Performance Tips

1. **Index script**: Use `--threads` to control parallelism (default uses all cores)
2. **Sync script**: Use `--limit` to process in batches
3. **Resume capability**: Both index and sync support resuming from checkpoints
4. **Incremental updates**: By default, scripts only process new/changed data

## Error Logging

All scripts write errors to `errors.log` in the current directory. Check this file if operations fail.
