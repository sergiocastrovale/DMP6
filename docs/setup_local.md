
### Backup Database

To create a local backup of the production database:

```bash
./backup
```

This command:
1. Connects to the NAS via SSH
2. Creates a compressed dump using `pg_dump` (runs inside the NAS's Postgres container)
3. Downloads it to `web/dump/` directory locally
4. Names it with timestamp: `YYYY-MM-DDTHH-MM-SS.sql.gz`

This is particularly useful for keeping a local copy of the production database. See [docs/scripts/backup.md](scripts/backup.md) for details.

### Restore Database Locally

To restore a backup to your local database:

```bash
./restore [filename]
```

Examples:
```bash
# Restore latest backup
./restore

# Restore specific backup
./restore 2026-02-18T14-30-00.sql.gz
```
