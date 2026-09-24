# Scripts: problems

Two modes of one binary: `--audit` scans the library, writes an XLSX of tag defects that break/degrade the index/sync pipeline; `--fix:<type>` resolves defects `--audit` found, writing tags only with a reliable, verified source. Exactly one of `--audit`/`--fix:<type>` required.

`--audit` is **strictly read-only** — never writes/moves/renames/deletes a file. `--fix:<type>` is the only writer, and never guesses — each fix type defines its own bar for "reliable enough to write", short of the bar leaves the file alone.

Fix types are grouped into 3 field umbrellas, not one flag per code — each runs every repair for its field, fixed precedence (normalize in place → derive from sibling/folder → MusicBrainz, year only), sharing one worklist per folder:

| Flag | Field | Repairs, in order |
|---|---|---|
| `--fix:year` | year | MusicBrainz on a perfect match (`YEAR_ZERO`/`YEAR_NON_NUMERIC`/`YEAR_TWO_DIGIT`/`YEAR_IMPLAUSIBLE`), else cleared |
| `--fix:artist` | `artist` | fill from `albumArtist`/folder majority (`ARTIST_MISSING`), then strip invisible chars (`ARTIST_INVISIBLE_CHARS`) |
| `--fix:albumartist` | `albumArtist` | fill from `artist`/folder majority (`ALBUMARTIST_MISSING`, `ALBUMARTIST_UNKNOWN_ARTIST`), rewrite unrecognised Various-Artists marker to canonical (`ALBUMARTIST_UNRECOGNISED_VARIOUS`), then strip invisible chars + trim (`ALBUMARTIST_INVISIBLE_CHARS`/`ALBUMARTIST_UNTRIMMED`) |

New repairs join an existing umbrella, or a new umbrella reuses the same worklist/ledger/report machinery.

## Usage

```bash
./problems --audit                            # scan $MUSIC_DIR, report to $PROJECT_ROOT/data/logs
./problems --audit --root /music
./problems --audit --only "Radiohead" [--exact]
./problems --audit --from a --to m
./problems --audit --limit-files 20000         # smoke test / thread benchmark
./problems --audit --threads 8                 # NAS tuning, default 16
./problems --audit --resume                    # continue interrupted scan
./problems --audit --restart                   # discard state, start over
./problems --audit --report-only               # rebuild xlsx from existing spool
./problems --audit -o /app/data/logs/problems.xlsx
./problems --audit --no-progress

./problems --fix:year [--dry-run]
./problems --fix:artist [--dry-run]
./problems --fix:albumartist [--dry-run]
```

NAS: `sudo ./problems --audit --root /music`

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--audit` | bool | - | Scan + write `problems.xlsx`. Mutually exclusive with `--fix:*`, one required |
| `--fix:year` | bool | - | Fix year defects — MB on perfect match, else cleared. Exclusive with `--audit` |
| `--fix:artist` | bool | - | Fix `artist` defects. Exclusive with `--audit` |
| `--fix:albumartist` | bool | - | Fix `albumArtist` defects. Exclusive with `--audit` |
| `--dry-run` | bool | false | `--fix:*` only: print changes, write nothing |
| `--root` | String | `$MUSIC_DIR` | Library root |
| `--output` / `-o` | String | `<work-dir>/problems.xlsx` | Report path |
| `--work-dir` | String | `$PROJECT_ROOT/data/logs` | Spool/checkpoint/ledger/default report |
| `--from` / `--to` / `--only` / `--exact` | | | `--audit` only: name filters |
| `--threads` | usize | 16 | `--audit` only |
| `--limit-files` | usize | - | `--audit` only |
| `--resume` / `--restart` / `--report-only` / `--no-progress` | bool | false | `--audit` only |

Env: `PROBLEMS_PANIC_TRACE=1` restores tag-parser panic backtraces (suppressed by default).

## Output

`problems.xlsx`, host-visible directory.

- **`Summary`** (leftmost) — run metadata, totals, autofiltered `Severity | Code | What it breaks | Files affected | Fixed | Remaining | % of files`, most-severe then most-frequent. `Files affected` = original `--audit` count, never decremented; `Fixed` = resolved since by `--fix:*`; `Remaining` = affected − fixed.
- **`Problems`**, `Problems (2)`, … — `path` / `file` / `reason`, one row per file (path repeats for siblings). All reasons for a file joined, severity-prefixed, most-severe first. A fixed row (in the ledger) is shaded green.

Excel caps a sheet at 1,048,576 rows — writer rolls to the next `Problems (N)` sheet at that point; Summary notes it.

Invisible characters are rendered visibly (`Bj<U+00A0>rk`), not stripped — stripping would hide the defect being reported. A collapsed disc subfolder keeps its prefix in `file` (`CD1/01.mp3`) so same-named files across discs stay distinguishable.

### Output location

Default `$PROJECT_ROOT/data/logs/` → `/app/data/logs/` in container (bind-mounted from `${DMP_DATA}/logs`, host-readable, survives container recreation). `reports/` deliberately not used — not a mounted volume.

## What `--audit` Checks

21 codes survive a larger original set — a full audit of real per-code counts found most of the first pass was noise or scanner-wrong-not-tags-wrong. **Retired entirely** (code + detector + report, one-time spool prune): `ORIGINALDATE_DIFFERS` (policy call, not a defect — real libraries routinely have `originaldate` *later* than `date`); `ALBUMARTIST_TOO_MANY_CO_OWNERS`/`_TOO_MANY_SEPARATORS` (legit long credit lists, film-score/tribute personnel); all 6 `FOLDER_*` structural codes (organisation observations, not per-file defects); `ALBUMARTIST_NUMERIC_JUNK` (see below — kept internally as a candidate-quality filter, no longer reported standalone).

**2 detector bugs found and fixed (not retired):**
- `ALBUMARTIST_BREAKS_LUCENE` was wrong about the consequence — `common::mb::api` built MB queries with an unescaped quote; MB's parser tolerates the broken syntax (still 200) but degrades into a noisy multi-candidate match, which the perfect-match-only resolvers distrust — real names like `Lee "Scratch" Perry` quietly failed to resolve. Fixed by escaping the query (`escape_lucene_phrase`), not the tag. Code retired (no defect left to report).
- `ARTIST_PUNCTUATION_ONLY`/`ALBUMARTIST_PUNCTUATION_ONLY` and `ARTIST_MOJIBAKE`/`ALBUMARTIST_MOJIBAKE` had real false positives — `!!!`/`+/-` are real band names (now whitelisted, `is_known_punctuation_artist_name`); mojibake's `CP1252_HIGH` set included 8 codepoints (`Š Œ Ž š œ ž Ÿ ƒ`) that are ordinary letters in real orthographies (Ladislav Křížek) — narrowed to symbols/punctuation only.

### Critical — data lost or permanently wrong

| Check | Consequence |
|---|---|
| `artist` missing/empty | File **never indexed**; breaks the folder's track count too, whole album stays UNMATCHED |
| `artist` whitespace-only | Passes the untrimmed empty-check, indexed as a junk artist |
| `title` empty | Matches the first unclaimed MB track, cascades wrong titles down the album |
| Tags unreadable / parser panic | File never indexed. **Report-only, never fixed** — nothing readable to derive a value from |

### High — junk artists or wrong ownership

| Check | Consequence |
|---|---|
| `albumArtist` missing | Release owned by whoever's on track 1 |
| `albumArtist` whitespace/punctuation-only | Junk artist, hash-based unbrowsable slug |
| Unrecognised comp marker (`V/A`, `V.A.`, `OST`, `Soundtrack`, `Verschiedene`, …) | Becomes a real browsable artist, synced to MB |
| `albumArtist = "Unknown Artist"` | Not special-cased, becomes one shared junk artist page |
| `artist`/`albumArtist` mojibake | Permanent garbled artist |
| Valid year present but date field malformed | Indexer reads date field first, gives up, loses the year |

### Medium — degrades matching

Invisible chars (NBSP, zero-width, BOM, replacement char); untrimmed `albumArtist` (defeats the Various-Artists guard); year zero/2-digit/non-numeric/implausible.

## `--audit` Phases

1. **Enumerate** — `read_dir` scan root, filter, sort case-insensitively.
2. **Scan** — per artist, walk release folders (disc subfolders collapsed like the indexer groups them), check every file on a rayon pool. Folder-level defects computed per folder, attributed to every file in it.
3. **Spool** — append rows as NDJSON, fsync, atomic checkpoint write.
4. **Report** — stream spool into the workbook.

Single folder-scoped pass, not global two-pass — peak memory bounded by the largest single folder, not the library (fits the container's 2GB cap).

## Resume (`--audit`)

Expensive scan and cheap report decoupled (XLSX can't be appended to).

- `problems.spool.jsonl` — append-only, one row/line.
- `problems.state.json` — last completed artist, counters, `spool_bytes`.

Rows flushed+fsynced *before* the checkpoint renames into place — a crash leaves the spool longer than the checkpoint claims. `--resume` truncates the spool back to `spool_bytes` → exact resume, no dupes, no loss.

`filter_key` blocks resuming a `--only` run into a full-library run. If state exists and neither `--resume` nor `--restart` given, tool **refuses to start** (no silent clobber of a multi-hour scan). `--resume` and `--restart` are mutually exclusive - passing both is a clap-level error, not `--resume` silently winning.

`--report-only` rebuilds the workbook from an existing spool (a bad-path/full-disk report failure costs seconds, not another scan) — also picks up any `--fix:*` runs since the last report.

## Fixing detected defects (`--fix:<type>`)

### Safeguard: nothing to fix without a prior `--audit`

`--fix:*` reads `problems.spool.jsonl` directly (never the xlsx — disposable, always rebuilt). Missing spool → refuses: `No scan found at <path> - run ./problems --audit first.` A hand-deleted xlsx alone doesn't block a fix (regenerated from spool+ledger after every non-dry-run fix anyway).

### Worklist: the spool, not the xlsx

`codes_in_rendered` matcher finds rows whose reason contains the target umbrella's codes — worklist can never drift from what the xlsx shows, and every `--fix:*` is immediately re-runnable after any future `--audit`. Rows grouped by release folder (1 MB lookup per folder for `--fix:year`, not per file) before per-file apply.

### Field umbrellas: one worklist, several repair modules

`FixKind::{Year, Artist, AlbumArtist}` each list every `ReasonCode` for their field. `--fix:artist`/`--fix:albumartist` dispatch to >1 module against the *same* worklist, merging outcomes. Each module is self-contained — re-reads live tags, only acts on its own defect shape, no-ops on a file handed for a different reason. `--fix:artist`: `artist_missing` then `text_normalize`. `--fix:albumartist`: `albumartist_missing` then `text_normalize`. `--fix:year`: just `years`, covering all 4 codes.

### `--fix:year`: how a release is resolved

1. **Majority** album+artist tags among the folder's own defective files (not first file — a folder can genuinely mix releases; no majority → skipped as error, not guessed).
2. `mb_search_release_group(album, artist)` — one search.
3. **Perfect-match gate** (`is_perfect_match`, no score threshold): normalized title equal, normalized artist-credit equal, passes allow-list (Album/EP, no spoken-word).
4. On a pass: release-group's own `first-release-date` → `leading_year`. Falls back to browsing editions only when the release-group legitimately lacks that field.
5. Any failure at any step → resolves to `None` (null), never a guess.

Same resolution applies to all 4 year codes uniformly (a 2-digit/implausible year is exactly as unrecoverable as zero/non-numeric); `defect_code` decides which one a file's *current* value still is right before writing.

MB search already retries transient 503/429 with backoff. A lookup still failing after that is an **error**, file left untouched — a network hiccup ≠ "no match", must not clear a field.

### Per-file apply

`read_tags_guarded` gets raw `RecordingDate`/`Year`; the same `recording`-then-`year` precedence `checks::year` uses picks the effective broken field — **only that `ItemKey`** written/removed, everything else untouched. Resolved year → plain 4-digit string; null result → `tag.remove_key` (not left as `"0000"`).

### `artist_missing` (part of `--fix:artist`)

No MB call — nothing reliable to search by (often `title` is empty too). Two sources, tried in order, from tags already on disk:
1. Same file's own `albumArtist`, if usable (`is_usable_candidate` reuses the scanner's own predicates — one shared definition of "usable" across every module).
2. Failing that, a **strict majority** `artist` across the *whole* folder (every file, not just defective — unlike `years`, trusting siblings is the correct signal even for a mixed folder).

No majority + no usable `albumArtist` → error, untouched (no "clear to null" — every outcome is `set` or nothing, never `cleared`).

### `albumartist_missing` (part of `--fix:albumartist`)

3 trigger shapes, 2 resolutions. `ALBUMARTIST_MISSING`/`_UNKNOWN_ARTIST` (literal "Unknown Artist" placeholder, as useless as absent) mirror `artist_missing`: own `artist` tag first, then strict-majority `albumArtist` among folder siblings. `ALBUMARTIST_UNRECOGNISED_VARIOUS` ("v.a.", "OST", …) is different — already unambiguously means Various-Artists, just spelled in a form the indexer's exact-match doesn't recognise: straight rewrite to canonical `"Various Artists"`, no sibling vote.

### Retired: `ALBUMARTIST_NUMERIC_JUNK`

Shipped once (mirror of `artist_missing`, roles reversed). Real data: most flagged rows (366/570 instances) were false positives — real artist names fitting a junk shape ("3", "213", "22-20s", "2562"). Fixed with a curated whitelist first, but real numeric-shaped names kept surfacing beyond it — a curated list can never stay ahead of an open-ended set of real band names, so the code was retired outright rather than extended again. `numeric_or_corrupted`/`is_known_numeric_artist_name` survive only as the candidate-quality filter inside `is_usable_candidate` — "should this be reported as broken" and "is this trustworthy enough to copy as a derived replacement" are different questions.

### `text_normalize` (part of both `--fix:artist` and `--fix:albumartist`)

The only module where the correct value derives from the broken value itself — no MB, no siblings. `normalize_tag_text` is a total pure transform: space-like invisible chars (NBSP) become a real space (deleting would fuse words); everything else `invisible_chars` flags is deleted outright; result trimmed. Bound to its two detectors by an invariant test: `invisible_chars(normalize(s))` empty, `is_untrimmed(normalize(s))` false, clean input byte-identical output.

Always normalizes **both** `artist` and `albumArtist` per file regardless of which field's code triggered it (dispatched from both umbrellas over non-overlapping worklists) — field-agnostic by design.

Doesn't special-case `U+FFFD` inside the transform itself (policy lives in `fix/text_normalize.rs`) — a field whose current value contains it, or whose normalized value fails `is_usable_candidate` (nothing left after stripping), refuses the **whole file**, not just that field (no partial write). Both fields independently re-checked/normalized but written+ledgered together — one `FixOutcome` per code actually resolved.

**Known gap:** some `ARTIST_INVISIBLE_CHARS` files (Picard-style) also carry a `TXXX:ARTISTS` frame with the same corrupted value. Scanner never reads that frame (only `TPE1`/`TPE2`), so it's never flagged and `text_normalize` correctly leaves it — touching an unflagged field would be the same mistake as guessing. Would need a new defect type, not a widening of this one.

### The fixed-row ledger

Every non-dry-run `--fix:*` appends to `<work-dir>/problems.fixed.jsonl` (one JSON object per resolved file, `set` or `cleared` — never `error`, so a failed file can never end up marked green):

```json
{"path":"...","file":"...","code":"YearZero","action":"set","field":"RecordingDate","old_value":"0000","new_value":"1990","fix_kind":"years","detail":{"mbReleaseGroupId":"...","mbTitle":"...","mbArtist":"..."},"fixed_at":"..."}
{"path":"...","file":"...","code":"ArtistMissing","action":"set","field":"Artist","old_value":"","new_value":"Hank Mobley","fix_kind":"artist-missing","detail":{"source":"folder-majority"},"fixed_at":"..."}
```

Shared across every fix type (`fix_kind` distinguishes entries — stable per-module strings, deliberately **not** renamed when CLI flags regrouped into umbrellas, so old entries stay valid; green-marking keys on `code`, not `fix_kind`). Consulted on **every** report regeneration (fresh `--audit`, `--report-only`, or the auto-regen after `--fix:*` writes) to green-mark rows and populate `Fixed`. No separate "mark the xlsx" step.

### Fixed pitfall: default parse mode failed on exactly the files this targets

`fix/tags.rs`'s writer opens the file separately from the scan's `read_tags_guarded`, originally with lofty's default `ParsingMode::BestAttempt`. A file whose effective field is `Year` could carry an unrelated malformed legacy frame (corrupt `TDAT` next to `TYER`) that `BestAttempt` errors on **at read time** — so exactly the files `--fix:year` targets could fail before a byte was written. Fixed by reusing `ParsingMode::Relaxed` (matching the scanner, which is why these files reached the spool at all) — `remove_key`/`insert`+`save_to_path` never touch the unrelated frame. Confirmed against real files (Midori, Eric Johnson, Little Feat).

## Build

`problems` must **not** be built with `cargo build --release`:

```bash
cd scripts && cargo build --profile scan -p problems   # -> target/scan/problems
```

`[profile.release]` sets `panic="abort"`, making `catch_unwind` a no-op — one corrupt file panicking the tag parser would kill a multi-hour `--audit` (and `--fix:*`, which reuses `read_tags_guarded`). `[profile.scan]` inherits release but sets `panic="unwind"` — a panic costs one row instead. (`panic` can't be set per-package, needs a separate profile.)

Binary warns at startup if built with `panic="abort"`; `--resume` makes even that survivable. The `./problems` wrapper and Dockerfile both use the scan profile already.

`--fix:*` additionally depends on `common` (MB client, rate limiter, allowlist, `normalize_name`) and a `tokio::runtime::Runtime` built only inside that branch — `--audit` never touches either, stays sync/rayon, no DB required to start.
