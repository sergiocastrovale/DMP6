# Setting up DMPv6

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database | PostgreSQL 16+ | Data storage |
| Schema | Prisma ORM | Type-safe DB access |
| Scripts | Rust | High-performance CLI tools |
| Metadata | `lofty` crate | Audio tag parsing |
| API | MusicBrainz | Canonical music data |
| Images | S3 + Local | Cover art storage |
| Analysis | Rust + HTML | Metadata reporting |

## Prerequisites

- **Rust** (stable toolchain): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **PostgreSQL 16+**
- **Node.js 20+** and **pnpm** (for Prisma): `npm install -g pnpm`

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

