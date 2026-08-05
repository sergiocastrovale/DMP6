# Scripts: problems

Two modes of one binary: `--audit` scans a music library and writes an XLSX report of tag defects
that break or degrade the index/sync pipeline; `--fix:<type>` resolves defects `--audit` found,
writing tags only when it has a reliable, verified source for the new value. Exactly one of
`--audit` / `--fix:<type>` is required per run.

`--audit` is **strictly read-only** - it opens audio files for reading and never writes, moves,
renames or deletes one. `--fix:<type>` is the only thing in this binary that writes tags, and it
never guesses: each fix type defines its own bar for "reliable enough to write" (MusicBrainz for
`--fix:years`, the file's own other tags or its release folder's consensus for
`--fix:artist-missing`), and short of that bar it leaves the file alone rather than writing a
best-effort value. `--years` and `--artist-missing` are the first two fix types; more are meant to
be added as new `--fix:<type>` flags reusing the same worklist/ledger/report-regeneration machinery.

## Usage

```bash
./problems --audit                            # Scan $MUSIC_DIR, report to $PROJECT_ROOT/data/logs
./problems --audit --root /music               # Explicit scan root
./problems --audit --only "Radiohead"          # Single artist (prefix match)
./problems --audit --only "Radiohead" --exact  # Single artist (exact match)
./problems --audit --from a --to m             # Letter range
./problems --audit --limit-files 20000         # Smoke test / thread benchmark
./problems --audit --threads 8                 # Tune for the NAS (default 16)
./problems --audit --resume                    # Continue an interrupted scan
./problems --audit --restart                   # Discard previous state, start over
./problems --audit --report-only               # Rebuild the xlsx from an existing spool
./problems --audit -o /app/data/logs/problems.xlsx  # Custom report path
./problems --audit --no-progress               # Disable the live progress line

./problems --fix:years                # Resolve YEAR_ZERO/YEAR_NON_NUMERIC against MusicBrainz
./problems --fix:years --dry-run      # Preview matches/years, write nothing

./problems --fix:artist-missing               # Fill in ARTIST_MISSING from albumArtist / folder majority
./problems --fix:artist-missing --dry-run     # Preview, write nothing
```

On the NAS:

```bash
sudo ./problems --audit --root /music
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--audit` | bool | - | Scan the library and write `problems.xlsx`. Mutually exclusive with `--fix:*`, one required |
| `--fix:years` | bool | - | Resolve `YEAR_ZERO`/`YEAR_NON_NUMERIC` against MusicBrainz. Mutually exclusive with `--audit`, one required |
| `--fix:artist-missing` | bool | - | Fill in `ARTIST_MISSING` from the file's own `albumArtist` or a folder majority. Mutually exclusive with `--audit`, one required |
| `--dry-run` | bool | false | `--fix:*` only: print what would change, write nothing (no tags, no ledger, no report regen) |
| `--root` | String | `$MUSIC_DIR` | Music library root |
| `--output` / `-o` | String | `<work-dir>/problems.xlsx` | Report path |
| `--work-dir` | String | `$PROJECT_ROOT/data/logs` | Spool, checkpoint, fixed-row ledger, default report location |
| `--from` | String | - | `--audit` only: only artist folders from this prefix |
| `--to` | String | - | `--audit` only: only artist folders up to this prefix (inclusive) |
| `--only` | String | - | `--audit` only: only artist folders starting with this prefix |
| `--exact` | bool | false | `--audit` only: make `--only` an exact match |
| `--threads` | usize | 16 | `--audit` only: worker threads |
| `--limit-files` | usize | - | `--audit` only: stop after roughly N files |
| `--resume` | bool | false | `--audit` only: continue a previous interrupted scan |
| `--restart` | bool | false | `--audit` only: discard previous state and start over |
| `--report-only` | bool | false | `--audit` only: skip scanning; rebuild the report from the spool |
| `--no-progress` | bool | false | `--audit` only: disable the live progress line |

Env: `PROBLEMS_PANIC_TRACE=1` restores tag-parser panic backtraces (suppressed by default so they don't drown the progress line).

## Output

`problems.xlsx`, written to a **host-visible** directory.

- **`Summary`** (leftmost tab) - run metadata, totals, and an autofiltered breakdown: `Severity | Code | What it breaks | Files affected | Fixed | Remaining | % of files`, sorted most-severe first then most-frequent. `Files affected` is the original count from the last `--audit` and is never decremented (the audit-trail total); `Fixed` is how many of those have since been resolved by a `--fix:*` run; `Remaining` is `Files affected - Fixed`, the live outstanding count. Read this before the detail sheet; it turns a large report into a short list of things to fix.
- **`Problems`**, then `Problems (2)`, `Problems (3)`, … - three columns, `path` / `file` / `reason`. **One row per file**, so `path` repeats when several files in the same folder are affected. All reasons for a file are joined into the one `reason` cell, severity-prefixed and sorted most-severe first. A row whose defect has been resolved by `--fix:*` (recorded in the fixed-row ledger) is shaded green - both the path/file cells (the row's identity) and the reason cell.

Excel caps a sheet at 1,048,576 rows including the header, so at 1,048,575 data rows the writer rolls over to the next `Problems (N)` sheet. The Summary sheet says when this happened.

Invisible characters are rendered visibly (`Bj<U+00A0>rk`) rather than stripped - stripping them would hide exactly the defect being reported.

Where a disc subfolder was collapsed into its release, `file` keeps it (`CD1/01.mp3`) so two same-named files in `CD1`/`CD2` remain distinguishable.

### Output location

Defaults to `$PROJECT_ROOT/data/logs/` → `/app/data/logs/` in the container, which is bind-mounted from `${DMP_DATA}/logs` and therefore readable on the host and survives the container.

`reports/` is deliberately **not** used: it is not a mounted volume, so anything written there is invisible from the host and is lost when the container is recreated.

## What `--audit` Checks

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

## `--audit` Phases

1. **Enumerate** - `read_dir` the scan root for artist folders, filter, sort case-insensitively.
2. **Scan** - per artist, walk its release folders (disc subfolders collapsed to match how the indexer groups a multi-disc set), then check every file across a rayon pool. Folder-level defects are computed per folder and attributed back to every file in it.
3. **Spool** - append rows as NDJSON, `fsync`, then atomically write the checkpoint.
4. **Report** - stream the spool into the workbook.

This is a single folder-scoped pass, not a global two-pass: peak memory is bounded by the largest single folder rather than by the library, which is what lets it run inside the container's 2 GB cap.

## Resume (`--audit`)

The expensive scan and the cheap report are decoupled, because XLSX cannot be appended to.

- `problems.spool.jsonl` - append-only, one row per line
- `problems.state.json` - last completed artist, counters, and `spool_bytes`

Rows are flushed and fsynced *before* the checkpoint is renamed into place, so a crash in that window leaves the spool longer than the checkpoint claims. `--resume` truncates the spool back to `spool_bytes`, which makes resume **exact** - no duplicated rows, no lost rows - rather than approximately right.

`filter_key` blocks resuming a `--only` run into a full-library run, which would produce a report covering neither.

If state exists and neither `--resume` nor `--restart` is given, the tool **refuses to start**. Silently clobbering a multi-hour scan is not a recoverable mistake.

`--report-only` rebuilds the workbook from an existing spool, so a report-writing failure (bad path, full disk) costs seconds rather than another full scan. It also picks up any `--fix:*` runs since the last report (see below).

## Fixing detected defects (`--fix:<type>`)

### Safeguard: nothing to fix without a prior `--audit`

`--fix:*` reads `problems.spool.jsonl` directly (never the xlsx - the xlsx is a disposable artifact, always rebuilt wholesale, same principle `--report-only` already relies on). If the spool doesn't exist - no `--audit` has ever run in this `--work-dir` - the tool refuses with `No scan found at <path> - run ./problems --audit first.` and exits. A hand-deleted `problems.xlsx` alone does **not** block a fix; only a missing spool does, because the xlsx gets regenerated from the spool + ledger at the end of every non-dry-run fix anyway.

### Worklist: the spool, not the xlsx

Reusing `problems`'s own `codes_in_rendered` matcher to find rows whose reason contains the fix type's target codes (`--fix:years` → `YearZero`/`YearNonNumeric`) means the worklist can never drift from what `problems.xlsx` shows, and every `--fix:*` is immediately re-runnable after any future `--audit` with no manual extraction step. Rows are grouped by release folder (one MB lookup per folder for `--fix:years`, not per file) before being applied per file.

### `--fix:years`: how a release is resolved

1. Take the **majority** album+artist tags among the folder's own defective files (not an arbitrary
   first file - a folder already flagged `FolderMultipleAlbums`/`FolderMultipleAlbumArtists` can
   genuinely mix several unrelated releases; no majority ⇒ skipped as an error, not guessed).
2. `mb_search_release_group(album, artist)` - one MusicBrainz release-group search.
3. **Perfect-match gate** (`is_perfect_match`, no score threshold, no fuzzy fallback):
   - `normalize_name(candidate.title) == normalize_name(local_album)`
   - `normalize_name(candidate.artist_credit) == normalize_name(local_artist)`
   - `allowlist::is_allowed(primary_type, secondary_types, None)` (Album/EP, no spoken-word
     secondary types)
4. On a pass, the release-group's own `first-release-date` (what MusicBrainz itself shows as this
   album's year) → parsed via `leading_year`. Falls back to browsing editions
   (`mb_get_release_tracks`) only when a release-group legitimately lacks that field.
5. Any failure at any step - no candidate, gate rejects, no parseable year - resolves to `None`
   (null), not a guess.

The MusicBrainz search itself already retries transient 503/429 responses with backoff (`common::mb::api::mb_get`). A lookup that still fails after that is an **error** and the file is left untouched - a network hiccup is not "no match" and must not clear a field.

### Per-file apply

For each file in a resolved (or nulled) group: `audio::read_tags_guarded` gets the raw `RecordingDate`/`Year` strings, and the same `recording`-then-`year` precedence `checks::year` uses picks which one is the "effective", broken field - **only that `ItemKey`** is written or removed. Every other tag item on the file is untouched. A resolved year is written as a plain 4-digit string (`tag.insert`); a null result removes the key (`tag.remove_key`) instead of leaving the original `"0000"`/`"xxxx"` behind.

### `--fix:artist-missing`: how a file is resolved

No MusicBrainz call at all - there is nothing reliable to search by on a file whose `title` is
frequently *also* empty (per `YearLostToMalformedDate`-style co-occurring defects, an
`ArtistMissing` row very often carries `TitleEmpty` too). Two sources, tried in order, both purely
from tags already on disk:

1. The same file's own `albumArtist`, if present and not machine junk (reuses the scanner's own
   `checks::artist` predicates - `index_treats_as_special`, `is_unknown_artist`,
   `numeric_or_corrupted`, `unrecognised_various` - so a value this fixer accepts is held to exactly
   the bar the detector uses to flag everything else).
2. Failing that, a **strict majority** `artist` value across the *whole* release folder (every audio
   file, not just the defective ones - unlike `--fix:years`, trusting siblings here is the correct
   signal rather than the risk: even a folder mixing several sub-albums, per `FolderMultipleAlbums`,
   is very often still one artist's whole discography dumped together).

No majority and no usable `albumArtist` ⇒ an error, file left untouched - there is no "clear to
null" for a field that is already null, so every outcome is `set` or nothing at all, never
`cleared`.

### The fixed-row ledger, and why the xlsx doesn't need a separate marking step

Every non-dry-run `--fix:*` appends to `<work-dir>/problems.fixed.jsonl` (one JSON object per
resolved file - `set` or `cleared`, never `error`; a failed file is never recorded, so it can never
end up silently marked green):

```json
{"path":"...","file":"...","code":"YearZero","action":"set","field":"RecordingDate","old_value":"0000","new_value":"1990","fix_kind":"years","detail":{"mbReleaseGroupId":"...","mbTitle":"...","mbArtist":"..."},"fixed_at":"..."}
{"path":"...","file":"...","code":"ArtistMissing","action":"set","field":"Artist","old_value":"","new_value":"Hank Mobley","fix_kind":"artist-missing","detail":{"source":"folder-majority"},"fixed_at":"..."}
```

This ledger is **shared across every fix type** (`fix_kind` distinguishes entries), and it is what `report::write_report` consults on *every* regeneration - a fresh `--audit`, `--audit --report-only`, or the automatic regeneration `--fix:*` triggers after writing tags - to green-mark rows and populate the Summary sheet's `Fixed` column. There is no separate "mark the xlsx" step; it is a native, automatic part of building the report, for as long as the ledger and spool both exist.

### Fixed pitfall: reading with lofty's default parse mode can fail on the exact files this targets

`fix/tags.rs`'s writer opens the file itself (separately from the `audio::read_tags_guarded` call
that built the worklist), and originally did so with lofty's default `ParseOptions` -
`ParsingMode::BestAttempt`, not `Relaxed`. A file whose effective field is `Year` (not
`RecordingDate`) can carry a second, unrelated malformed legacy ID3v2.3 frame (e.g. a corrupt `TDAT`
day/month sitting next to `TYER`) that `BestAttempt` eagerly errors on **at read time** - so the
exact files `--fix:years` exists to fix could fail before a single byte was written. Reusing
`ParsingMode::Relaxed` (matching the scanner, which is why these files reached the spool at all)
fixes it: the tag opens fine, and `tag.remove_key`/`insert` + `save_to_path` never touch the
unrelated malformed frame at all. Confirmed against real files from each previously-affected release
(Midori, Eric Johnson, Little Feat) before shipping.

## Build

`problems` is the one binary that must **not** be built with `cargo build --release`:

```bash
cd scripts && cargo build --profile scan -p problems   # -> target/scan/problems
```

`[profile.release]` sets `panic = "abort"`, which makes `catch_unwind` a no-op - so one corrupt file that panics the tag parser would kill a multi-hour `--audit` run (and, since `--fix:*` reuses the same `read_tags_guarded`, a `--fix:*` run too). `[profile.scan]` inherits release but sets `panic = "unwind"` so a panic costs a single row instead. (`panic` cannot be set per-package; it has to be a separate profile.)

The binary warns at startup if it was built with `panic = "abort"`, and `--resume` makes even that survivable.

The `./problems` wrapper and the Dockerfile both use the scan profile already.

`--fix:*` additionally depends on `common` (MusicBrainz client, rate limiter, `mb::allowlist`, `mb::names::normalize_name`) and a `tokio::runtime::Runtime` built only inside that branch - `--audit` never touches either, staying fully sync/rayon and never requiring `common::config`/a database to start.
