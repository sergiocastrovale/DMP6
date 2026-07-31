# Scripts: backup

Streams a compressed PostgreSQL dump from the NAS into `web/dump/`.

## Usage

```bash
./backup
```

Output:

```
web/dump/YYYY-MM-DDTHH-MM-SS.sql.gz
```

## How It Works

1. SSHes into the NAS using the `nas` host alias from `~/.ssh/config` (set up in [docs/truenas.md](../truenas.md)).
2. Runs `pg_dump --no-owner --no-acl --clean --if-exists` **inside** the `ix-postgres-postgres-1` container, so the dump uses the server's own `pg_dump` and the local PostgreSQL client version is irrelevant.
3. Pipes the dump through `gzip -9` (maximum compression) **on the NAS side**, so the wire only carries already-compressed bytes.
4. Streams those bytes back over SSH straight into the local file - nothing is buffered to memory or to a temp file on the NAS.
5. Verifies the result with `gzip -t` and a minimum-size check; if either fails, the partial file is deleted so you never end up with a corrupt dump.

The dump is **read-only** from the database's perspective - `pg_dump` never modifies anything, and the script never issues `DROP`/`CREATE` against the live database.

## Configuration

Reads from `web/.env`. All values have sensible defaults; override only if your setup differs.

| Variable | Default | Purpose |
|---|---|---|
| `NAS_SSH_HOST` | `nas` | SSH host alias or `user@host` |
| `POSTGRES_CONTAINER` | `ix-postgres-postgres-1` | Postgres container name on the NAS |
| `BACKUP_DB_USER` | `dmp` | Database role |
| `BACKUP_DB_NAME` | `dmp` | Database name |

## Restore

The `./restore` wrapper (`scripts/restore`) reads `web/dump/*.sql.gz` and is fully compatible with the files this script produces.
