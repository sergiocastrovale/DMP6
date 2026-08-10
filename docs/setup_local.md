# Local setup

```bash
cp web/.env.example web/.env      # fill in DATABASE_URL, MUSIC_DIR, SESSION_SECRET
cd web
pnpm install
pnpm db:push                      # create tables
pnpm db:seed                      # admin/admin, forced password change on first login
pnpm dev                          # http://localhost:3000
```

Rust binaries (needed for `./index`, `./sync`, …):

```bash
cd scripts && cargo build --release
```

Postgres install and troubleshooting: [dev_guide.md](dev_guide.md).

## Populate from production

Fastest way to get a real catalogue locally — no indexing, no MusicBrainz calls.

```bash
./backup                          # NAS → web/dump/YYYY-MM-DDTHH-MM-SS.sql.gz (+ _img.tar.gz)
./restore                         # newest dump → local PostgreSQL
./restore 2026-02-18T14-30-00.sql.gz   # or a specific one
```

Details and configuration: [scripts/backup.md](scripts/backup.md).

Images referenced by the restored rows live in the image archive; extract it over `web/public/img/`,
or set `REMOTE_SERVER_URL` in `web/.env` to proxy missing images and audio from the NAS instead.
