# Scripts: backup

Pulls a compressed PostgreSQL dump **and** an image archive from the NAS into `web/dump/`.

## Usage

```bash
./backup              # Database + images
./backup --db-only    # Database only
./backup --img-only   # Images only
```

Output:

```
web/dump/YYYY-MM-DDTHH-MM-SS.sql.gz       # pg_dump
web/dump/YYYY-MM-DDTHH-MM-SS_img.tar.gz   # everything under NAS_IMG_DIR
```

## How It Works

1. SSHes into the NAS using the `nas` host alias from `~/.ssh/config` (set up in [docs/truenas.md](../truenas.md)).
2. Runs `sudo docker exec` + `pg_dump --no-owner --no-acl --clean --if-exists` **inside** the Postgres container, so the dump uses the server's own `pg_dump` and the local client version is irrelevant.
3. Compresses with `gzip -9` (DB) and `tar -cf - | gzip -9` (images) **on the NAS**, writing both into `NAS_DUMP_DIR`, then copies them down — the wire only carries already-compressed bytes.
4. Verifies each archive with `gzip -t` and a minimum-size check; a failed check deletes the partial file, so a corrupt archive never lands in `web/dump/`.

Read-only from the database's perspective: `pg_dump` modifies nothing, and the script never issues `DROP`/`CREATE` against the live database.

## Configuration

Reads `web/.env`. All values have defaults; override only if your setup differs.

| Variable | Default | Purpose |
|---|---|---|
| `NAS_SSH_HOST` | `nas` | SSH host alias or `user@host` |
| `POSTGRES_CONTAINER` | `ix-postgres-postgres-1` | Postgres container name on the NAS |
| `BACKUP_DB_USER` | `dmp` | Database role |
| `BACKUP_DB_NAME` | `dmp` | Database name |
| `NAS_DUMP_DIR` | `/mnt/SSD/web/dmp/dump` | Where archives are built on the NAS |
| `NAS_IMG_DIR` | `/mnt/SSD/web/dmp/img` | Image directory to archive |

## Restore

`./restore [file.sql.gz]` loads the newest (or named) dump from `web/dump/` into the local PostgreSQL
named by `DATABASE_URL`. Database only — image archives are extracted by hand.
