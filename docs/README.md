# DMP v6 Documentation Index

Welcome to the DMP v6 documentation. This index provides an overview of all available documentation.

## Quick Start

1. **[Setup Guide](sync.md)** - Install PostgreSQL, Rust, and configure environment
2. **[Database Schema](schema.md)** - Understanding the database structure
3. **[Image Storage](images.md)** - S3 and local image handling

## Core Documentation

### System Architecture

- **[PRD.md](PRD.md)** - Product requirements and project goals
- **[schema.md](schema.md)** - Complete database schema reference
- **[sync.md](sync.md)** - Scripts setup, usage, and workflow

### Scripts & Tools

- **[sync.md](sync.md)** - Main scripts documentation:
  - `./index` - File indexer (Rust)
  - `./sync` - MusicBrainz sync (Rust)
  - `./nuke` - Database cleanup (Rust)
  - `./clean` - Image cleanup (Rust)
  - `./analysis` - Metadata analysis (Rust)

- **[analysis.md](analysis.md)** - Metadata analysis tool
  - Scan millions of files for missing tags
  - Generate HTML reports
  - Find metadata issues

- **[images.md](images.md)** - Image storage system
  - S3 integration
  - Local storage
  - Deletion handling

### Future Integrations

- **[slsk.md](slsk.md)** - Soulseek integration (planned)
- **[beets.md](beets.md)** - Beets metadata cleanup (planned)

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              Music Files (Local)                │
│         /mnt/i/mp3/mainstream/                  │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   ./index (Rust)     │
         │  Extract metadata    │
         │  Save cover art      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   PostgreSQL DB      │
         │  - Artists           │
         │  - LocalReleases     │
         │  - LocalReleaseTracks│
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   ./sync (Rust)      │
         │  Fetch MusicBrainz   │
         │  Match releases      │
         │  Download images     │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   Status Updates     │
         │  - COMPLETE          │
         │  - INCOMPLETE        │
         │  - MISSING           │
         └──────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database | PostgreSQL 16+ | Data storage |
| Schema | Prisma ORM | Type-safe DB access |
| Scripts | Rust | High-performance CLI tools |
| Metadata | `lofty` crate | Audio tag parsing |
| API | MusicBrainz | Canonical music data |
| Images | S3 + Local | Cover art storage |
| Analysis | Rust + HTML | Metadata reporting |

## File Structure

```
DMPv6/
├── docs/              # Documentation (you are here)
│   ├── README.md      # This file
│   ├── PRD.md         # Product requirements
│   ├── schema.md      # Database schema
│   ├── sync.md        # Scripts setup & reference
│   ├── images.md      # Image storage guide
│   ├── analysis.md    # Analysis tool docs
│   ├── slsk.md        # Soulseek integration (planned)
│   └── beets.md       # Beets integration (planned)
│
├── scripts/           # Rust CLI tools
│   ├── index/         # File indexer
│   ├── sync/          # MusicBrainz sync
│   ├── nuke/          # Database cleanup
│   ├── clean/         # Image cleanup
│   └── analysis/      # Metadata analysis
│
├── web/               # Web application (future)
│   ├── prisma/        # Prisma schema & migrations
│   │   └── schema.prisma
│   ├── public/
│   │   └── img/       # Local image storage
│   │       ├── artists/
│   │       └── releases/
│   └── .env           # Configuration
│
├── index              # Indexer wrapper script
├── sync               # Sync wrapper script
├── nuke               # Nuke wrapper script
├── clean              # Clean wrapper script
├── analysis           # Analysis wrapper script
└── errors.log         # Centralized error log
```

## Environment Configuration

Required variables in `web/.env`:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dmp6

# Music directory
MUSIC_DIR=/path/to/music

# Image storage (local, s3, or both)
IMAGE_STORAGE=both

# S3 configuration (if using S3)
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_PUBLIC_URL=https://your-bucket.s3.amazonaws.com
```

See `web/.env.example` for complete template.

## Common Workflows

### Initial Setup

```bash
# 1. Install dependencies
sudo apt install postgresql
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install -g pnpm

# 2. Configure database
sudo service postgresql start
cd web && pnpm install && pnpm prisma db push

# 3. Configure environment
cp web/.env.example web/.env
nano web/.env  # Edit MUSIC_DIR and DATABASE_URL

# 4. Run initial index
./index

# 5. Sync with MusicBrainz
./sync
```

### Regular Maintenance

```bash
# After adding new music
./index --resume

# Sync new artists
./sync

# Clean up orphaned images
./clean

# Generate metadata report
./analysis /path/to/music
```

### Troubleshooting

```bash
# Check errors
tail -f errors.log

# Re-index specific artist
./index --only="Radiohead" --overwrite

# Force re-sync
./sync --overwrite

# Clear checkpoint
psql -U dmp6 -d dmp6 -c 'DELETE FROM "IndexCheckpoint";'
```

## Status Legend

- ✅ **COMPLETE** - Fully implemented and tested
- 🚧 **PLANNED** - Documented but not yet implemented
- ⚠️ **EXPERIMENTAL** - Implemented but may change

| Feature | Status |
|---------|--------|
| File indexing | ✅ COMPLETE |
| MusicBrainz sync | ✅ COMPLETE |
| Local image storage | ✅ COMPLETE |
| S3 image storage | ✅ COMPLETE |
| Image cleanup | ✅ COMPLETE |
| Database cleanup | ✅ COMPLETE |
| Metadata analysis | ✅ COMPLETE |
| Soulseek integration | 🚧 PLANNED |
| Beets integration | 🚧 PLANNED |
| Web UI | 🚧 PLANNED |

## Getting Help

- **Check logs**: `tail -f errors.log`
- **Read docs**: Start with `sync.md` for setup
- **Search issues**: Check for known problems
- **Test with limits**: Use `--limit` flags for debugging

## Contributing

When updating documentation:
1. Keep technical accuracy over marketing language
2. Include code examples where helpful
3. Update this index when adding new docs
4. Use consistent formatting across all docs
