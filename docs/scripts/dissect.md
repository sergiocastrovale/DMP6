# Scripts: dissect

Turns `errors.log` (written by `index`/`sync` via `common::error_log`) into a structured XLSX report, so
a run's failures can be triaged by category instead of grepped.

Read-only: it never touches the database or any audio file.

## Usage

```bash
./dissect                                   # errors.log → reports/errors.xlsx
./dissect --input /path/errors.log --output reports/run7.xlsx
```

| Flag | Short | Default | Description |
|---|---|---|---|
| `--input` | `-i` | wherever `common::error_log` itself writes (below) | Log file to parse |
| `--output` | `-o` | `reports/errors.xlsx` | XLSX path to write |

`--input`'s default calls `common::error_log::default_log_path()` - the same resolution every
writer uses - rather than a bare relative `errors.log`, which almost never matches once `PROJECT_ROOT`
is set. On the NAS the log lives inside the container at `/app/data/logs/errors.log`:
`sudo docker exec dmp cat /app/data/logs/errors.log`.

## Output

A Legend sheet (category, description, error count) plus one sheet per category:

| Sheet | Meaning |
|---|---|
| No Artist Tag | Files with no usable artist/albumArtist tag — index cannot place them |
| Cannot Read Tags | Unreadable or corrupt tag block (lofty failure) |
| DB Error | Database failure during upsert |
| Other | Anything unmatched by the patterns above |

Rows are grouped per artist/path, with counts, so a folder that failed 200 times is one line rather
than 200.
