---
name: audit-fix
description: Run audit → review issues in /issues UI → queue fixes → run fix → refresh. Full recurring metadata remediation cycle.
user-invocable: true
---

# Audit & Fix

The structured workflow for detecting and fixing metadata issues in the library. Replaces the ad-hoc Python scripts for the common cases.

---

## Overview

```
./audit           →  writes DETECTED rows to 6 issue tables
/issues UI        →  review, edit proposed values, select rows, click "Fix Selected"
  (queues rows)   →  status changes DETECTED → PENDING
./fix --{type}    →  reads PENDING rows, applies fixes, sets RESOLVED or FAILED
./refresh    →  re-reads file tags back into DB (only after file-writing fix types)
```

The web terminal (`/issues/[type]` page) runs `./fix` automatically when you click "Fix Selected". The `./audit` is triggered from `/issues` (overview page, "Run Audit" button).

---

## Issue Types and Fix Actions

| Type | `./audit` flag | `./fix` flag | Writes files? | Reindex after? |
|------|---------------|-------------|---------------|----------------|
| corrupted | `--corrupted` | `--corrupted` | Yes (albumArtist tag) | Yes |
| unsplit | `--unsplit` | `--unsplit` | Yes (albumArtist → primary; artist → compound) | Yes |
| orphans | `--orphans` | `--orphans` | No (deletes Artist from DB) | No |
| duplicates | `--duplicates` | `--duplicates` | No (merges B→A in DB, deletes B image) | No |
| missing | `--missing` | `--missing` | Yes (writes missing tag fields) | Yes |
| enrichment | `--enrichment` | *(no fix)* | No | No |

**File-writing types** (corrupted, unsplit, missing): after `./fix`, the changed tags need to be re-read into the DB. The UI shows a "Refresh" button scoped to the affected artists after the terminal exits with code 0.

**Enrichment**: has no automated fix and no SelectionBar. Per-row "Re-sync" button appears only for releases where `mbRelease` is a missing field (triggers `./refresh --only="Artist Name"`). Other enrichment gaps (BPM, mood, etc.) require external tools — see the `enrichment-gaps` skill.

---

## Detection Logic: Key Non-Obvious Rules

### Corrupted TPE2

Patterns flagged as corrupted:
- `^\d{1,3}$` — purely numeric 1-3 digits (track numbers)
- `^\d{1,3}\s*-\s*\S` — track-number prefix (e.g. `05 - Title`)
- `@\d{2,3}$` — bitrate marker (e.g. `Artist @320`)
- `albumArtist = year::text` — year leaked into TPE2
- Full path strings (detected by length + path-like chars)

Proposed fix is derived by majority vote of non-corrupt peers in the same release, then linked artists, then TPE1 consensus. Confidence: high ≥ 3 peers, medium ≥ 1, low = none.

### Unsplit Artists

Only these separators trigger detection (by design — `&` is too ambiguous without MB validation):
- ` feat. ` (space-padded, dot-terminated only)
- ` vs ` (space-padded)
- ` vs. ` (space-padded, dot-terminated)
- ` & ` (always detected in the name, proposed split is literal `&` split)
- ` / ` (space-padded slash)
- `; ` (semicolon-space)

`ft.`, `featuring`, `feat` (no dot), `ft` — **not** detected. If you see these in artist names, they need manual handling or a regex extension in `scripts/audit/src/unsplit.rs`.

### Orphans

Only two reasons (by design — `no_tracks` was removed as it caused false positives for MB-credited artists):
- `phantom` — artist name matches `^\d{1,3}$` or `@\d{2,3}$`
- `no_releases` — absent from **all three** junction tables: `LocalReleaseArtist`, `TrackArtist`, AND `MusicBrainzReleaseArtist`

An artist with `LocalReleaseArtist` rows but no `TrackArtist` rows is **not** an orphan — that's a valid MB-credited artist without file-level tags.

### Duplicates

Detected by normalized name collision: `LOWER(REGEXP_REPLACE(name, '[^a-z0-9]', '', 'gi'))`. Skipped if both have distinct non-null `musicbrainzId`s (they're genuinely different artists with the same normalized name). Canonical (A) = higher track count; B is merged into A.

### Missing Metadata

Fields checked: `title`, `artist`, `albumArtist`, `album`, `year`. Only writes file tags where `proposedValues` is non-null. Proposed values come from peer tracks in the same release (year majority vote) or from the other artist field (albumArtist ↔ artist). Missing title or album → `proposedValues = null` → row shows "manual" badge, cannot be auto-fixed.

---

## Status Flow

```
DETECTED  →  (user selects + clicks Fix Selected)  →  PENDING
PENDING   →  (./fix runs)  →  RESOLVED  or  FAILED
```

The UI only shows `DETECTED` rows. `RESOLVED`/`FAILED` rows are hidden. After `./fix` completes, `issuesStore.fetchType()` is called automatically (watch on `terminal.exitCode`), which refreshes the table.

The watch has a `hasFixed` guard — it only triggers a refresh when a fix was actually queued in this session, not on stale exit codes from previous terminal runs.

---

## Running Manually (CLI)

```bash
# Detect all issue types
./audit

# Detect one type only
./audit --corrupted
./audit --unsplit
./audit --orphans
./audit --duplicates
./audit --missing
./audit --enrichment

# Apply pending fixes (after queuing via UI or direct DB update)
./fix --corrupted
./fix --unsplit
./fix --orphans
./fix --duplicates
./fix --missing

# After file-writing fix, re-read tags into DB
./refresh --only="Artist Name"
# or without scoping:
./refresh
```

To queue rows without the UI:
```sql
UPDATE "IssueCorruptedTpe2" SET status = 'PENDING' WHERE status = 'DETECTED';
```

---

## Architecture: Where Things Live

| Concern | Location |
|---------|----------|
| Detection logic | `scripts/audit/src/{type}.rs` |
| Fix logic | `scripts/fix/src/{type}.rs` |
| Tag writes | `scripts/fix/src/tags.rs` |
| Image deletion | `dmp_fix::tags::delete_artist_image(config, filename)` — uses `config.project_root` + S3 |
| API list endpoint | `web/server/api/issues/[type].get.ts` |
| API queue endpoint | `web/server/api/issues/[type]/queue.post.ts` |
| API patch endpoint | `web/server/api/issues/[type]/[id].patch.ts` |
| Summary counts | `web/server/api/issues/summary.get.ts` |
| Store | `web/stores/issues.ts` |
| Types | `web/types/issues.ts` — `IssueType`, `EnrichmentField`, row interfaces |
| Per-type page | `web/pages/issues/[type].vue` |
| Table component | `web/components/issues/IssueTable.vue` |
| Slot names | Keys transformed via `.replace(/[^a-zA-Z0-9]/g, '_')` — e.g. `artist.name` → `cell-artist_name` |

---

## DB Tables

```
AuditRun              — one row per ./audit invocation, tracks counts
IssueCorruptedTpe2    — corrupted albumArtist tags; links to LocalReleaseTrack
IssueUnsplitArtist    — compound artist names; links to Artist
IssueOrphanArtist     — phantom/unreachable artists; links to Artist
IssueDuplicateArtist  — normalized-name collisions; links to Artist (A=keep, B=merge)
IssueMissingMetadata  — tracks missing core fields; links to LocalReleaseTrack
IssueEnrichmentGap    — releases missing enrichment fields; links to LocalRelease
```

All have `status IssueStatus` (DETECTED/PENDING/RESOLVED/FAILED) and cascade-delete from AuditRun.

---

## Known Limitations

- **Re-audit overwrites**: each `./audit --{type}` deletes all existing rows of that type and reinserts fresh. PENDING rows from a previous audit that haven't been fixed yet are lost. Fix before re-auditing, or don't re-audit that type selectively.
- **Enrichment no-fix**: there is no `./fix --enrichment`. Enrichment gaps are informational only, except `mbRelease` which is addressed by re-syncing.
- **Tmux required**: the in-app terminal uses tmux sessions. If tmux is not installed, `./audit` and `./fix` via the web UI will fail with a clear error message. Run manually from CLI instead.
- **Duplicate merge unique violations**: if artist B has overlapping releases with artist A in `LocalReleaseArtist`, the merge deletes the B duplicates first then updates the remainder — safe against unique constraint violations.
