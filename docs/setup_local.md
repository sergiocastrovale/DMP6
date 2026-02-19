
### Backup Database

To create a local backup of the local database:

```bash
pnpm backup
```

This command:
1. Connects to the production database via SSH
2. Creates a compressed dump using `pg_dump`
3. Downloads it to `dump/` directory locally
4. Names it with timestamp: `dmp6_YYYY-MM-DD_HH-MM-SS.sql.gz`

This is particularly useful whenever you want to send the latest catalogue changes to the live server via `pnpm deploy:db`.

### Restore Database Locally

To restore a backup to your local database:

```bash
pnpm restore [filename]
```

Examples:
```bash
# Restore latest backup
pnpm restore

# Restore specific backup
pnpm restore dmp6_2026-02-18_14-30-00.sql.gz
```
