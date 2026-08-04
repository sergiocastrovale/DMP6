# Scripts: problems

Standalone filesystem scanner - reads audio tags directly (no DB, no network), detects tag conditions that break or degrade the index/sync pipeline, writes an XLSX report.

**Strictly read-only.** It opens audio files for reading and never writes, moves, renames or deletes one. There is no quarantine mode and no autofix mode, deliberately.

## Usage

```bash
./problems                                    # Scan $MUSIC_DIR, report to $PROJECT_ROOT/data/logs
./problems --root /music                      # Explicit scan root
./problems --only "Radiohead"                 # Single artist (prefix match)
./problems --only "Radiohead" --exact         # Single artist (exact match)
./problems --from a --to m                    # Letter range
./problems --limit-files 20000                # Smoke test / thread benchmark
./problems --threads 8                        # Tune for the NAS (default 16)
./problems --resume                           # Continue an interrupted scan
./problems --restart                          # Discard previous state, start over
./problems --report-only                      # Rebuild the xlsx from an existing spool
./problems -o /app/data/logs/problems.xlsx    # Custom report path
./problems --no-progress                      # Disable the live progress line
```

On the NAS:

```bash
sudo ./problems --root /music
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--root` | String | `$MUSIC_DIR` | Music library root |
| `--output` / `-o` | String | `<work-dir>/problems.xlsx` | Report path |
| `--work-dir` | String | `$PROJECT_ROOT/data/logs` | Spool + checkpoint + default report location |
| `--from` | String | - | Only artist folders from this prefix |
| `--to` | String | - | Only artist folders up to this prefix (inclusive) |
| `--only` | String | - | Only artist folders starting with this prefix |
| `--exact` | bool | false | Make `--only` an exact match |
| `--threads` | usize | 16 | Worker threads |
| `--limit-files` | usize | - | Stop after roughly N files |
| `--resume` | bool | false | Continue a previous interrupted scan |
| `--restart` | bool | false | Discard previous state and start over |
| `--report-only` | bool | false | Skip scanning; rebuild the report from the spool |
| `--no-progress` | bool | false | Disable the live progress line |

Env: `PROBLEMS_PANIC_TRACE=1` restores tag-parser panic backtraces (suppressed by default so they don't drown the progress line).

## Output

`problems.xlsx`, written to a **host-visible** directory.

- **`Summary`** (leftmost tab) - run metadata, totals, and an autofiltered breakdown: `Severity | Code | What it breaks | Files affected | % of files`, sorted most-severe first then most-frequent. Read this before the detail sheet; it turns a large report into a short list of things to fix.
- **`Problems`**, then `Problems (2)`, `Problems (3)`, … - three columns, `path` / `file` / `reason`. **One row per file**, so `path` repeats when several files in the same folder are affected. All reasons for a file are joined into the one `reason` cell, severity-prefixed and sorted most-severe first.

Excel caps a sheet at 1,048,576 rows including the header, so at 1,048,575 data rows the writer rolls over to the next `Problems (N)` sheet. The Summary sheet says when this happened.

Invisible characters are rendered visibly (`Bj<U+00A0>rk`) rather than stripped - stripping them would hide exactly the defect being reported.

Where a disc subfolder was collapsed into its release, `file` keeps it (`CD1/01.mp3`) so two same-named files in `CD1`/`CD2` remain distinguishable.

### Output location

Defaults to `$PROJECT_ROOT/data/logs/` → `/app/data/logs/` in the container, which is bind-mounted from `${DMP_DATA}/logs` and therefore readable on the host and survives the container.

`reports/` is deliberately **not** used: it is not a mounted volume, so anything written there is invisible from the host and is lost when the container is recreated.

## What Gets Checked

### Critical - data is lost or permanently wrong

| Check | Consequence |
|---|---|
| `artist` missing/empty | File is **never indexed**; the missing track also breaks the folder's track count, so the whole album stays UNMATCHED |
| `artist` whitespace-only | Passes the indexer's untrimmed empty-check and is indexed as a junk artist |
| `title` empty | An empty title matches the first unclaimed MusicBrainz track, cascading wrong titles down the album |
| `albumArtist` with a quote or odd trailing backslash | Breaks the unescaped MusicBrainz query → HTTP 400 → deferred forever, re-fetched every run, ownership never resolved |
| Tags unreadable / parser panic | File is never indexed |

### High - creates junk artists or wrong ownership

| Check | Consequence |
|---|---|
| `albumArtist` missing | Release is owned by whoever happens to be on track 1 |
| `albumArtist` whitespace/punctuation-only | Junk artist with a hash-based, unbrowsable slug |
| Unrecognised compilation marker (`V/A`, `V.A.`, `Various Artist`, `OST`, `Soundtrack`, `Compilation`, `Verschiedene`, …) | Becomes a real browsable artist and is synced to MusicBrainz |
| `albumArtist` = `Unknown Artist` | Not special-cased, so it becomes one shared junk artist page |
| `albumArtist` numeric junk (`07`, `12 - Intro`, `Artist@320`, a bare year) | Junk artist |
| `artist`/`albumArtist` mojibake | Permanent garbled artist |
| ≥9 separators in `albumArtist` | Too many to verify; every part is created unverified |
| Folder has multiple `albumArtist` values | Each becomes a co-owner, putting the album on unrelated artists' pages |
| No file in the folder has an `album` tag | Release is titled "Unknown Album" and cannot be found on MusicBrainz |
| Valid year present but the date field is malformed | The indexer reads the date field first and gives up, losing the year |

### Medium - degrades matching

Invisible characters (NBSP, zero-width, BOM, replacement char); untrimmed `albumArtist` (defeats the untrimmed Various-Artists guard); more than 4 co-billed artists (all but the first are demoted, so the album vanishes from their pages); year zero / two-digit / non-numeric / implausible; `originaldate` differing from `date` (binds to the reissue, not the original); folder with multiple `album` or `year` values.

### Low - cosmetic, but a duplicate-artist risk

Case drift within a folder; `The X` vs `X` drift. The latter earns its place because the post-indexing duplicate-artist audit normalises to lowercased alphanumerics and so **can never** match `thebeatles` against `beatles`.

## Phases

1. **Enumerate** - `read_dir` the scan root for artist folders, filter, sort case-insensitively.
2. **Scan** - per artist, walk its release folders (disc subfolders collapsed to match how the indexer groups a multi-disc set), then check every file across a rayon pool. Folder-level defects are computed per folder and attributed back to every file in it.
3. **Spool** - append rows as NDJSON, `fsync`, then atomically write the checkpoint.
4. **Report** - stream the spool into the workbook.

This is a single folder-scoped pass, not a global two-pass: peak memory is bounded by the largest single folder rather than by the library, which is what lets it run inside the container's 2 GB cap.

## Resume

The expensive scan and the cheap report are decoupled, because XLSX cannot be appended to.

- `problems.spool.jsonl` - append-only, one row per line
- `problems.state.json` - last completed artist, counters, and `spool_bytes`

Rows are flushed and fsynced *before* the checkpoint is renamed into place, so a crash in that window leaves the spool longer than the checkpoint claims. `--resume` truncates the spool back to `spool_bytes`, which makes resume **exact** - no duplicated rows, no lost rows - rather than approximately right.

`filter_key` blocks resuming a `--only` run into a full-library run, which would produce a report covering neither.

If state exists and neither `--resume` nor `--restart` is given, the tool **refuses to start**. Silently clobbering a multi-hour scan is not a recoverable mistake.

`--report-only` rebuilds the workbook from an existing spool, so a report-writing failure (bad path, full disk) costs seconds rather than another full scan.

## Build

`problems` is the one binary that must **not** be built with `cargo build --release`:

```bash
cd scripts && cargo build --profile scan -p problems   # -> target/scan/problems
```

`[profile.release]` sets `panic = "abort"`, which makes `catch_unwind` a no-op - so one corrupt file that panics the tag parser would kill a multi-hour run. `[profile.scan]` inherits release but sets `panic = "unwind"` so a panic costs a single row instead. (`panic` cannot be set per-package; it has to be a separate profile.)

The binary warns at startup if it was built with `panic = "abort"`, and `--resume` makes even that survivable.

The `./problems` wrapper and the Dockerfile both use the scan profile already.
