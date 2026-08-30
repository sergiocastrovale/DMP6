# Dev guide

Local development setup. Conventions, data model, commands and API/page inventory live in
[CLAUDE.md](../CLAUDE.md) — that file is canonical; this one covers getting a machine running.

## Stack

- **Node.js 20+** and **pnpm** (for Prisma): `npm install -g pnpm`
- **Framework**: Nuxt 4 + Vue 3 + TypeScript
- **Styling**: Tailwind CSS v4, on the token/recipe layer described in [design_system.md](design_system.md) (`web/assets/css/theme.css` + `web/helpers/ui.ts`). No custom CSS except the exceptions listed in CLAUDE.md (animated conic-gradient border, Leaflet control overrides) — both already have a shared, non-scoped home in `main.css`; the remaining component-local copies are transitional, see design_system.md
- **Icons**: Lucide (`lucide-vue-next`)
- **State**: Pinia with localStorage persistence (`pinia-plugin-persistedstate`)
- **Database**: Prisma + PostgreSQL 16+ (schema at `web/prisma/schema.prisma`)
- **Audio**: HTML5 Audio API, streamed from `MUSIC_DIR` (server and files on same machine)
- **Images**: Configurable via `IMAGE_STORAGE` env. Prefer S3 `imageUrl` when available, fall back to local `image` field
- **Utilities**: `@vueuse/core`, `date-fns`
- **Rust** (stable toolchain): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

## Coding Standards

Full list in CLAUDE.md. The load-bearing ones:

- All TypeScript definitions live in `web/types/`
- Tailwind utilities only; icons from Lucide only
- Keep database queries performant - use Prisma `select` to limit fields, proper indexes
- No Rust/scripts logic reimplemented in the web app - the app shells out to the binaries via `/api/terminal/run`
- Tests: `pnpm test:unit` for every change, `pnpm test:e2e` (needs `pnpm build` first) for UI/flow changes


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

Use the role/database named in `DATABASE_URL` (`dmp`/`dmp` by default):

```bash
sudo -u postgres psql <<SQL
CREATE USER dmp WITH PASSWORD 'dmp';
CREATE DATABASE dmp OWNER dmp;
GRANT ALL PRIVILEGES ON DATABASE dmp TO dmp;
SQL
```

### Verify connection

```bash
psql -U dmp -d dmp -h localhost -c "SELECT 1;"
```

## Database Schema

The Prisma schema at `web/prisma/schema.prisma` is the source of truth. Install dependencies and push the schema:

```bash
cd web && pnpm install && pnpm prisma db push && cd ..
```

This creates all tables and relations automatically. Run this whenever the schema changes.

## Common Workflows

### First setup

```bash
./index
./sync
```

### After adding new music

```bash
./refresh          # index (skips already-indexed files) then sync
./index --resume   # only to continue a run that was interrupted
```

### Fine-tuning metadata

```bash
./analysis         # metadata quality report in /reports
./problems --audit # per-file tag defects → problems.xlsx
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
