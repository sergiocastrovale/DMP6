# Scripts: problems

Two modes of one binary: `--audit` scans a music library and writes an XLSX report of tag defects
that break or degrade the index/sync pipeline; `--fix:<type>` resolves defects `--audit` found,
writing tags only when it has a reliable, verified source for the new value. Exactly one of
`--audit` / `--fix:<type>` is required per run.

`--audit` is **strictly read-only** - it opens audio files for reading and never writes, moves,
renames or deletes one. `--fix:<type>` is the only thing in this binary that writes tags, and it
never guesses: each fix type defines its own bar for "reliable enough to write" and short of that
bar leaves the file alone rather than writing a best-effort value.

Fix types are grouped into three field umbrellas rather than one flag per defect code - each
umbrella runs every repair that applies to its field, in a fixed precedence (normalize in place →
derive from a sibling/folder source → MusicBrainz, year only), sharing one worklist per folder:

| Flag | Field | Repairs, in order |
|---|---|---|
| `--fix:year` | year | MusicBrainz on a perfect match (`YEAR_ZERO`/`YEAR_NON_NUMERIC`/`YEAR_TWO_DIGIT`/`YEAR_IMPLAUSIBLE`), otherwise cleared |
| `--fix:artist` | `artist` | fill from `albumArtist`/folder majority (`ARTIST_MISSING`), then strip invisible characters (`ARTIST_INVISIBLE_CHARS`) |
| `--fix:albumartist` | `albumArtist` | fill from `artist`/folder majority (`ALBUMARTIST_MISSING`, `ALBUMARTIST_UNKNOWN_ARTIST`), rewrite an unrecognised Various Artists marker to the canonical spelling (`ALBUMARTIST_UNRECOGNISED_VARIOUS`), replace machine-junk from `artist`/folder majority (`ALBUMARTIST_NUMERIC_JUNK`), then strip invisible characters and trim whitespace (`ALBUMARTIST_INVISIBLE_CHARS`/`ALBUMARTIST_UNTRIMMED`) |

More repairs are meant to be added to an existing umbrella, or a new umbrella added for a new field,
reusing the same worklist/ledger/report-regeneration machinery.

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

./problems --fix:year                  # Fix every year defect (MusicBrainz on a perfect match, else clear)
./problems --fix:year --dry-run       # Preview matches/years, write nothing

./problems --fix:artist                # Fix every artist-field defect (fill, then strip invisible chars)
./problems --fix:artist --dry-run     # Preview, write nothing

./problems --fix:albumartist           # Fix every albumArtist-field defect (fill/rewrite/replace/normalize)
./problems --fix:albumartist --dry-run  # Preview, write nothing
```

On the NAS:

```bash
sudo ./problems --audit --root /music
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--audit` | bool | - | Scan the library and write `problems.xlsx`. Mutually exclusive with `--fix:*`, one required |
| `--fix:year` | bool | - | Fix every year defect (`YEAR_ZERO`/`YEAR_NON_NUMERIC`/`YEAR_TWO_DIGIT`/`YEAR_IMPLAUSIBLE`) - MusicBrainz on a perfect match, otherwise cleared. Mutually exclusive with `--audit`, one required |
| `--fix:artist` | bool | - | Fix every `artist`-field defect: fill `ARTIST_MISSING` from `albumArtist`/folder majority, then strip invisible characters (`ARTIST_INVISIBLE_CHARS`). Mutually exclusive with `--audit`, one required |
| `--fix:albumartist` | bool | - | Fix every `albumArtist`-field defect: fill `ALBUMARTIST_MISSING`/`ALBUMARTIST_UNKNOWN_ARTIST` from `artist`/folder majority, rewrite `ALBUMARTIST_UNRECOGNISED_VARIOUS` to the canonical spelling, replace `ALBUMARTIST_NUMERIC_JUNK`, then strip invisible characters and trim whitespace. Mutually exclusive with `--audit`, one required |
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

22 codes survive an earlier, much larger set - a full audit of every code against real per-code
counts and value samples found that most of what a first pass flagged was either noise nobody wanted
reported or the scanner being wrong rather than the tags. Retired entirely (code, detector, and
report, with a one-time spool prune in place of a re-scan): `ORIGINALDATE_DIFFERS` (a policy call,
not a defect - real libraries routinely have `originaldate` *later* than `date`, so it is often the
unreliable field); `ALBUMARTIST_TOO_MANY_CO_OWNERS`/`ALBUMARTIST_TOO_MANY_SEPARATORS` (legitimate
long credit lists, e.g. film-score/tribute-album personnel); and all six `FOLDER_*` structural codes
(`FOLDER_MULTIPLE_ALBUMS`/`_ALBUMARTISTS`/`_YEARS`, `FOLDER_ALBUM_EMPTY`, `FOLDER_ARTIST_CASE_DRIFT`,
`FOLDER_ARTIST_THE_PREFIX_DRIFT`) - observations about how a folder is organised, not defects in any
one file's tags.

Two detector bugs found and fixed in the same pass, rather than retired: `ALBUMARTIST_BREAKS_LUCENE`
turned out to be **wrong about the consequence** - `common::mb::api` built the MusicBrainz query with
an unescaped quote (`format!("\"{}\"", name)`), and live testing showed MusicBrainz's parser
tolerates the broken syntax rather than rejecting it (still HTTP 200), degrading into a noisy
multi-candidate match instead of one clean hit. That noise is exactly what the PERFECT-match-only
resolvers here are built to distrust, so real names like `Lee "Scratch" Perry` or
`Bonnie "Prince" Billy` were quietly failing to resolve, not hard-failing. Fixed by escaping the
query (`escape_lucene_phrase` in `common::mb::api`), not by touching the tag - the code is retired
because there is no longer a defect to report. `ARTIST_PUNCTUATION_ONLY`/`ALBUMARTIST_PUNCTUATION_ONLY`
and `ARTIST_MOJIBAKE`/`ALBUMARTIST_MOJIBAKE` had real false positives: `!!!` and `+/-` are real band
names with no letters or digits (now a curated whitelist,
`checks::artist::is_known_punctuation_artist_name`), and the mojibake detector's `CP1252_HIGH` char
set included 8 codepoints (`Š Œ Ž š œ ž Ÿ ƒ`) that are ordinary letters in real orthographies -
`Ladislav Křížek`, `Tomáš Klár` - narrowed to symbols/punctuation only, which never legitimately
double as the second half of a real accented-letter pair.

### Critical - data is lost or permanently wrong

| Check | Consequence |
|---|---|
| `artist` missing/empty | File is **never indexed**; the missing track also breaks the folder's track count, so the whole album stays UNMATCHED |
| `artist` whitespace-only | Passes the indexer's untrimmed empty-check and is indexed as a junk artist |
| `title` empty | An empty title matches the first unclaimed MusicBrainz track, cascading wrong titles down the album |
| Tags unreadable / parser panic | File is never indexed. **Report-only, deliberately never fixed** - by definition there is nothing readable to derive a value from |

### High - creates junk artists or wrong ownership

| Check | Consequence |
|---|---|
| `albumArtist` missing | Release is owned by whoever happens to be on track 1 |
| `albumArtist` whitespace/punctuation-only | Junk artist with a hash-based, unbrowsable slug |
| Unrecognised compilation marker (`V/A`, `V.A.`, `Various Artist`, `OST`, `Soundtrack`, `Compilation`, `Verschiedene`, …) | Becomes a real browsable artist and is synced to MusicBrainz |
| `albumArtist` = `Unknown Artist` | Not special-cased, so it becomes one shared junk artist page |
| `albumArtist` numeric junk (`07`, `12 - Intro`, `Artist@320`, a bare year) | Junk artist |
| `artist`/`albumArtist` mojibake | Permanent garbled artist |
| Valid year present but the date field is malformed | The indexer reads the date field first and gives up, losing the year |

### Medium - degrades matching

Invisible characters (NBSP, zero-width, BOM, replacement char); untrimmed `albumArtist` (defeats the
untrimmed Various-Artists guard); year zero / two-digit / non-numeric / implausible.

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

Reusing `problems`'s own `codes_in_rendered` matcher to find rows whose reason contains the target
umbrella's codes (`--fix:year` → `YearZero`/`YearNonNumeric`/`YearTwoDigit`/`YearImplausible`) means
the worklist can never drift from what `problems.xlsx` shows, and every `--fix:*` is immediately
re-runnable after any future `--audit` with no manual extraction step. Rows are grouped by release
folder (one MB lookup per folder for `--fix:year`, not per file) before being applied per file.

### Field umbrellas: one worklist, several repair modules

`FixKind::{Year, Artist, AlbumArtist}` each list every `ReasonCode` that belongs to their field
(`fix::mod::FixKind::codes`); `--fix:artist` and `--fix:albumartist` dispatch to more than one
underlying repair module against the *same* shared worklist, one after another, merging their
outcomes. Each module is independently self-contained - it re-reads the file's live tags and only
acts on its own specific defect shape, no-opping harmlessly on a file it was handed for a different
reason - so sharing one worklist across several modules is safe: `--fix:artist` runs
`artist_missing` then `text_normalize`; `--fix:albumartist` runs `albumartist_missing`, then
`albumartist_numeric_junk`, then `text_normalize`. `--fix:year` has just the one module
(`years`), covering all four year codes directly.

### `--fix:year`: how a release is resolved

1. Take the **majority** album+artist tags among the folder's own defective files (not an arbitrary
   first file - a folder can genuinely mix several unrelated releases; no majority ⇒ skipped as an
   error, not guessed).
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

The same resolution applies uniformly to all four year codes - a two-digit or implausible year
(`"0"`, `"0196"`) is exactly as unrecoverable by padding/clamping as a zero or non-numeric one;
`defect_code(raw, current_year)` (mirroring `checks::year::check_dates`' own classification) decides
which of the four a file's *current* value still is, immediately before writing.

The MusicBrainz search itself already retries transient 503/429 responses with backoff (`common::mb::api::mb_get`). A lookup that still fails after that is an **error** and the file is left untouched - a network hiccup is not "no match" and must not clear a field.

### Per-file apply

For each file in a resolved (or nulled) group: `audio::read_tags_guarded` gets the raw `RecordingDate`/`Year` strings, and the same `recording`-then-`year` precedence `checks::year` uses picks which one is the "effective", broken field - **only that `ItemKey`** is written or removed. Every other tag item on the file is untouched. A resolved year is written as a plain 4-digit string (`tag.insert`); a null result removes the key (`tag.remove_key`) instead of leaving the original `"0000"`/`"xxxx"` behind.

### `artist_missing` (part of `--fix:artist`): how a file is resolved

No MusicBrainz call at all - there is nothing reliable to search by on a file whose `title` is
frequently *also* empty (per `YearLostToMalformedDate`-style co-occurring defects, an
`ArtistMissing` row very often carries `TitleEmpty` too). Two sources, tried in order, both purely
from tags already on disk:

1. The same file's own `albumArtist`, if present and not machine junk (`fix::candidates::is_usable_candidate`
   reuses the scanner's own `checks::artist` predicates - `index_treats_as_special`,
   `is_unknown_artist`, `numeric_or_corrupted`, `unrecognised_various` - so a value this fixer accepts
   is held to exactly the bar the detector uses to flag everything else. Shared with
   `albumartist_numeric_junk`/`albumartist_missing`, below, so every fixer applies one definition of
   "usable", not several that can drift).
2. Failing that, a **strict majority** `artist` value across the *whole* release folder (every audio
   file, not just the defective ones - unlike `years`, trusting siblings here is the correct
   signal rather than the risk: even a folder mixing several sub-albums is very often still one
   artist's whole discography dumped together). `fix::candidates::folder_majority` is generic over
   which field to vote on, shared with every module below too.

No majority and no usable `albumArtist` ⇒ an error, file left untouched - there is no "clear to
null" for a field that is already null, so every outcome is `set` or nothing at all, never
`cleared`.

### `albumartist_missing` (part of `--fix:albumartist`): `ALBUMARTIST_MISSING` / `ALBUMARTIST_UNKNOWN_ARTIST` / `ALBUMARTIST_UNRECOGNISED_VARIOUS`

Three trigger shapes, two resolutions. `ALBUMARTIST_MISSING` and `ALBUMARTIST_UNKNOWN_ARTIST` (the
literal `"Unknown Artist"` placeholder - exactly as useless as absent, since the indexer has no
special case for it either) are the mirror of `artist_missing` above, roles reversed: the file's own
`artist` tag first, then a strict majority `albumArtist` among the folder's other files.
`ALBUMARTIST_UNRECOGNISED_VARIOUS` (`"v.a."`, `"OST"`, ...) is different - these already
unambiguously mean "various-artists compilation", just spelled in a form the indexer's exact-match
check does not recognise, so there is no sibling vote: straight rewrite to the canonical
`"Various Artists"` string `checks::artist::index_treats_as_various` (the scanner's mirror of
`common::artists::is_various_artists`) actually recognises.

### `albumartist_numeric_junk` (part of `--fix:albumartist`): how a file is resolved, and the detector fix that came first

Same shape as `artist_missing`, roles reversed - here `albumArtist` is the broken field and the
file's own `artist` is the first place to look for a replacement:

1. Re-verify the *current* `albumArtist` still trips `checks::artist::numeric_or_corrupted` (tags, or
   the detector, may have changed since the scan - see below) - if not, an error, not a write.
2. The same file's own `artist`, if present and not machine junk.
3. Failing that, a strict majority `albumArtist` across the release folder's *other* files whose
   `albumArtist` is present and not junk.

No candidate clears either bar ⇒ an error, file left untouched. Unlike the two fields above, this one
already holds *something* - leaving known-wrong data in place beats guessing or silently blanking a
field that at least currently has a value, so there is no `cleared` outcome here either, only `set`
or nothing.

**Before writing any fix code for this type, the real data changed the plan.** Pulling the actual
`ALBUMARTIST_NUMERIC_JUNK` rows showed the overwhelming majority (366 of 570 instances, 52 of 54
folders in one snapshot) were false positives from `checks::artist::numeric_or_corrupted` itself -
real artists whose name happens to fit one of its junk shapes: `"3"` and `"213"` (bare-digit rule -
real bands, one an actual group named after an album literally called *"213 - The Hard Way"*),
`"22-20s"`/`"24-7 Spyz"` (numbered-track-title rule), `"2562"` (bare-year rule, a real Berlin
electronic producer). The function already had exactly this escape hatch for one of its four
sub-rules (`is_numeric_band_name`, now `is_known_numeric_artist_name` - renamed since it's no longer
bare-digit-specific), just wired to guard only that one branch. The fix moved the whitelist check to
the top of the function, covering all four shapes, and extended it with the five confirmed-real names
above. Existing tests already pinned the tradeoff this preserves: tightening either shape rule instead
would reintroduce a documented false negative (`"07-Song"` with no space around the dash must still be
caught), so a curated exact-match exception list - not a looser heuristic - is the fix, same as the
bare-digit rule already used.

Fixing the detector doesn't retroactively clean an existing spool - a row flagged before the fix stays
in the report as a defect until the *next* `--audit` re-scans the file. `albumartist_numeric_junk`'s
own re-verification step (`numeric_or_corrupted` on the *current* value, per file, per run) is what
keeps this safe in the meantime: run it against a stale spool and every now-false-positive row
correctly resolves to "no longer looks like junk" - an error, not a write - rather than "fixing" a
file that was never actually broken.

### `text_normalize` (part of both `--fix:artist` and `--fix:albumartist`): `ARTIST_INVISIBLE_CHARS` / `ALBUMARTIST_INVISIBLE_CHARS` / `ALBUMARTIST_UNTRIMMED`

The only repair module where the correct value is derivable from the broken value itself - no
MusicBrainz, no sibling files, no folder majority. `checks::text::normalize_tag_text` is the total,
pure transform (space-like invisible characters, e.g. NBSP, become a real space rather than being
deleted - deleting would fuse adjacent words; everything else `invisible_chars` flags renders as
nothing and is deleted outright; the result is trimmed, which is the same operation `is_untrimmed`
checks). It is bound to the two detectors it exists to satisfy by an invariant test, not by
convention: for every input, `invisible_chars(normalize(s))` must be empty and `is_untrimmed(normalize(s))`
must be false, and a clean input must come back byte-identical.

Always checks and normalizes **both** `artist` and `albumArtist` on every file it processes,
regardless of which field's code put the file in the worklist - it is dispatched from both
umbrellas over their own (non-overlapping) worklists, so a file can only reach it once per code, but
if the same file happens to need both fields fixed under one umbrella's run, both get fixed in that
one pass. This is a behavioural non-issue, not a special case: the module was already field-agnostic
before the umbrella regrouping, checking whatever the current tags show rather than trusting why it
was called.

This module does not special-case `U+FFFD` (the replacement character) inside `normalize_tag_text`
itself - that's a policy decision, made by `fix/text_normalize.rs`, not a property of the transform.
A field whose *current* value contains `U+FFFD`, or whose normalized value fails
`fix::candidates::is_usable_candidate` (nothing left after stripping - the value was entirely
invisible characters), refuses the **whole file**, not just that field: a partial write would leave
the file in a state the scan never described. `artist` and `albumArtist` are independently
re-checked and independently normalized, but written and ledgered together per file when both need
it - one `FixOutcome` per code actually resolved, so a file fixing both `ARTIST_INVISIBLE_CHARS` and
`ALBUMARTIST_INVISIBLE_CHARS` produces two ledger entries, keeping the Summary sheet's per-code
counts accurate.

**Known gap, found while verifying the real fix on disk:** some files (the `ARTIST_INVISIBLE_CHARS`
ones, from Picard-style tagging) also carry a `TXXX:ARTISTS` frame - a non-standard multi-artist
credit list - with the *same* corrupted value. The scanner never reads this frame (only `artist`/
`albumArtist`, i.e. `TPE1`/`TPE2`), so it was never flagged and `text_normalize` correctly
leaves it untouched - touching an unflagged field would be the same mistake as guessing. The file is
not fully clean of invisible characters after the fix; `TPE1`/`TPE2` are, because those are the only
two fields this defect type was ever about. Extending the scanner to also check `TXXX:ARTISTS` would
be a new, separate defect type, not a widening of these three.

### The fixed-row ledger, and why the xlsx doesn't need a separate marking step

Every non-dry-run `--fix:*` appends to `<work-dir>/problems.fixed.jsonl` (one JSON object per
resolved file - `set` or `cleared`, never `error`; a failed file is never recorded, so it can never
end up silently marked green):

```json
{"path":"...","file":"...","code":"YearZero","action":"set","field":"RecordingDate","old_value":"0000","new_value":"1990","fix_kind":"years","detail":{"mbReleaseGroupId":"...","mbTitle":"...","mbArtist":"..."},"fixed_at":"..."}
{"path":"...","file":"...","code":"ArtistMissing","action":"set","field":"Artist","old_value":"","new_value":"Hank Mobley","fix_kind":"artist-missing","detail":{"source":"folder-majority"},"fixed_at":"..."}
{"path":"...","file":"...","code":"AlbumArtistNumericJunk","action":"set","field":"AlbumArtist","old_value":"999","new_value":"J.J. Cale","fix_kind":"albumartist-numeric-junk","detail":{"source":"artist"},"fixed_at":"..."}
{"path":"...","file":"...","code":"AlbumArtistUnrecognisedVarious","action":"set","field":"AlbumArtist","old_value":"V.A.","new_value":"Various Artists","fix_kind":"albumartist-missing","detail":{"source":"canonical-various"},"fixed_at":"..."}
{"path":"...","file":"...","code":"ArtistInvisibleChars","action":"set","field":"Artist","old_value":"Death Cab for Cutie & Jay​-​Z","new_value":"Death Cab for Cutie & Jay-Z","fix_kind":"text-normalize","detail":null,"fixed_at":"..."}
```

This ledger is **shared across every fix type** (`fix_kind` distinguishes entries - these are stable
per-module strings and were deliberately **not** renamed when the CLI flags regrouped into field
umbrellas, so historical entries stay valid; green-marking keys on `code`, not `fix_kind`, so the
rename would have been cosmetic only), and it is what `report::write_report` consults on *every*
regeneration - a fresh `--audit`, `--audit --report-only`, or the automatic regeneration `--fix:*`
triggers after writing tags - to green-mark rows and populate the Summary sheet's `Fixed` column.
There is no separate "mark the xlsx" step; it is a native, automatic part of building the report,
for as long as the ledger and spool both exist.

### Fixed pitfall: reading with lofty's default parse mode can fail on the exact files this targets

`fix/tags.rs`'s writer opens the file itself (separately from the `audio::read_tags_guarded` call
that built the worklist), and originally did so with lofty's default `ParseOptions` -
`ParsingMode::BestAttempt`, not `Relaxed`. A file whose effective field is `Year` (not
`RecordingDate`) can carry a second, unrelated malformed legacy ID3v2.3 frame (e.g. a corrupt `TDAT`
day/month sitting next to `TYER`) that `BestAttempt` eagerly errors on **at read time** - so the
exact files `--fix:year` exists to fix could fail before a single byte was written. Reusing
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
