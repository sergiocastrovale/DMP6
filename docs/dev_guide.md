# Dev guide

This document is the single source of truth for the DMP v6 web application.

## Stack

- **Node.js 20+** and **pnpm** (for Prisma): `npm install -g pnpm`
- **Framework**: Nuxt 4.x (latest) + Vue 3 + TypeScript
- **Styling**: Tailwind CSS v4 only (absolutely no custom CSS)
- **Icons**: Lucide (`lucide-vue-next`)
- **State**: Pinia with localStorage persistence (`pinia-plugin-persistedstate`)
- **Database**: Prisma + PostgreSQL 16+ (schema at `web/prisma/schema.prisma`)
- **Audio**: HTML5 Audio API, streamed from `MUSIC_DIR` (server and files on same machine)
- **Images**: Configurable via `IMAGE_STORAGE` env. Prefer S3 `imageUrl` when available, fall back to local `image` field
- **Utilities**: `@vueuse/core`, `date-fns`
- **Rust** (stable toolchain): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

## Coding Standards

- All TypeScript definitions live in `web/types/`
- API consolidated with centralized patterns in `server/api/`
- Zero CSS - Tailwind utility classes only
- Icons from Lucide only
- Keep database queries performant - use Prisma `select` to limit fields, proper indexes
- No scripts-related code, no downloader code, no CLI invocation code


## PostgreSQL Setup (WSL2 / Ubuntu)

### Install

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
```

### Start the service

```bash
sudo service postgresql start
```

### Create database and user

```bash
sudo -u postgres psql <<SQL
CREATE USER dmp6 WITH PASSWORD 'dmp6';
CREATE DATABASE dmp6 OWNER dmp6;
GRANT ALL PRIVILEGES ON DATABASE dmp6 TO dmp6;
SQL
```

### Verify connection

```bash
psql -U dmp6 -d dmp6 -h localhost -c "SELECT 1;"
```

## Database Schema

The Prisma schema at `web/prisma/schema.prisma` is the source of truth. Install dependencies and push the schema:

```bash
cd web && pnpm install && pnpm prisma db push && cd ..
```

This creates all tables and relations automatically. Run this whenever the schema changes.

## Common Workflows

### Initial Setup

### Fine-tuning metadata
```bash
# Generate metadata report in /reports
./analysis
```

### First setup

```bash
./index
./sync
```

### After adding new music

```bash
# After adding new music
./index --resume

# Sync new artists
./sync
```

###  Clean up orphaned images

```bash
# Cleans orphaned artist and release images from S3, local or both
./clean
```

###  Rebuild entire DB and catalogue

```bash
# Starts from scratch
./nuke && ./index && ./sync
```

### Troubleshooting

```bash
# Check errors
tail -f errors.log

# Re-index specific artist
./index --only="Radiohead" --overwrite

# Force re-sync
./sync --overwrite
```
