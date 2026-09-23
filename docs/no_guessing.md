# No guessing release placement — ambiguous folders become UNKNOWN with a reason

> **Implementation brief.** Self-contained: a cold session should be able to read this file and
> implement without re-deriving anything. Line anchors were verified on `master` @ `7474ac19`

> **Status: shipped 2026-09-23.** Implemented, tested, committed (`0c7bcb3e`), deployed, and the
> one-off ran against production - preview numbers matched the post-run count exactly (16,822
> flagged, 5,039 previously `COMPLETE`). Confirmed final counts and the exact reason split:
> `docs/specs/spec_tidy_observations.md` §19 "Round 8". Undo dumps were skipped in favor of a
> `./backup` taken immediately before Tx 1/Tx 2 - see "Undo dumps" below, now corrected for what
> actually worked on this NAS. Still open: the user's own visual check of the artist-page stacks
> (Verification section below) - not self-verified, per standing rule.
---

## Context

Artist pages show fake "N editions" stacks (Al Jolson "The World's Greatest Entertainer" ×5,
"In Songs He Made Famous" ×6) built from unrelated budget compilations. Two guessing mechanisms:

- **index** titles a folder-release with the *mode* of its tracks' `album`/`year` tags
  (`folder_majority_title_year`, `scripts/index/src/db.rs:63-93`), so a folder whose tracks name five
  different albums gets titled after whichever string appears most.
- **sync** binds on a plurality / ">50%" of embedded MB ids (`tags_agree_on` `main.rs:291`,
  `get_majority_id` `:307`, `majority_from_counts` `:344`), *rescues* a scattered folder when the
  candidate's tracklist happens to score COMPLETE (`main.rs:1482-1501`), and "upgrades" to a deluxe
  sibling (`main.rs:1520-1568`) — so those folders bind to real MB releases inside one release group,
  which the artist page stacks by `releaseGroupId`.

**Rule: no guessing release placement. Not 100% sure → `UNKNOWN` + a human-readable `statusReason`.**

- Album tag must be **unanimous** across the folder's tracks.
- Embedded MB album id must be **unanimous among the tracks that carry one** (untagged tracks are
  absent evidence, never a veto).
- Album comparison = trim + whitespace-collapse + NFC + case-fold. Nothing looser.
- An ambiguous release displays its **folder leaf name** — a narrow, display-only exception to
  "never read folder names", justified because there is no metadata left to display.

**Measured prod impact** (read-only, excluding box-placed / folded / `forcedComplete`):
16,822 releases → UNKNOWN. Album disagree 14,688 · missing album tag 19 · MB-id disagree with album
unanimous 2,115. Of those, 11,017 are currently bound and **5,039 are currently COMPLETE**
(per-track-tagged folders that sync had rescued). This is the intended consequence of the rule.

### Decisions settled 2026-09-22 (user-confirmed, previously open)

1. **Release-id divergence is terminal even when the release group is unanimous.** Tier 2 is *not* a
   rescue path. That case gets its own reason string so the cause stays legible in the UI.
2. **`status.rs`'s edition tie-break stays** (`status.rs:226-265`: same year → CD format → earliest
   date, among editions whose track count matches exactly). Explicitly out of scope.
3. **No extra scope.** Left open, unchanged: index ownership majority (`sync_decisions.md` §19 item
   8), `problems`/`audit` tag-fix majorities, and the round-7 shared-`releaseId` shape
   (`spec_tidy_observations.md` §18). **Note round 7 is *not* fixed by unanimity** — each of those
   folders is internally consistent; the Al Jolson "The Man and the Legend" ×3 stack survives this
   change. Say so in the docs rather than letting the verification step imply otherwise.
4. **Full rollout this time**: implement → test → commit → `./deploy` → undo dumps → one-off Tx 1 +
   Tx 2 → `./tidy --rescore-only --all`.

### Non-goals (state them in the docs so they aren't mistaken for oversights)

- `pick_folder_image_owner` (artist-image plurality) — not release placement.
- Box-set partial bind `members*2 >= siblings` — a structural guard; members are still tracklist-paired.
- `problems --fix:artist` / `--fix:albumartist` / `audit --corrupted` peer-majority tag fills — they
  write *tags*, are human-reviewed through `/issues`, and are not release placement.

---

## 1. Shared helper — new `scripts/common/src/consensus.rs`

Add `pub mod consensus;` to `scripts/common/src/lib.rs` (currently: `artists, checkpoint, config, db,
error_log, filters, images, lock, mb, progress, release_pairs, run_hash, s3, slug, statistics, tags,
totals, types`).

### Reason constants

Stored **verbatim** in the DB and rendered as-is by the web popover — no key→string mapping. This
matches how `MusicBrainzRelease.statusReason` already stores `Recordings inside "…"`, and keeps
`ReleaseGroupDetails.vue:172` (`release.statusReason || statusDescription(...)`) working untouched.

| # | const | string |
|---|---|---|
| 1 | `ALBUM_DIVERGENCE` | `Tracks in the release folder disagree in 'album' metadata field` |
| 2 | `ALBUM_MISSING` | `Some tracks in the release folder have no 'album' metadata field` |
| 3 | `ALBUM_INEXISTENT` | `No track in the release folder has an 'album' metadata field` |
| 4 | `MB_ALBUM_DIVERGENCE_RG_UNANIMOUS` | `Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID` |
| 5 | `MB_ALBUM_DIVERGENCE` | `Tracks in the release folder disagree on the embedded MusicBrainz album id` |
| 6 | `MB_RELEASE_GROUP_DIVERGENCE` | `Tracks in the release folder disagree on the embedded MusicBrainz release group id` |

Constraint: **no reason may start with `Recordings inside "`** — `containmentContainerTitle`
(`web/helpers/functions.ts:263-269`, regex `/^Recordings inside "(.+)"$/`) keys off that prefix and
would render a containment pill. Its existing tests (`web/test/helpers/functions.test.ts:495-513`)
already prove arbitrary other strings return `null`.

### Precedence

First match wins, evaluated in exactly this order:

```
1. no track has a non-empty album tag                          -> ALBUM_INEXISTENT
2. >1 distinct normalized album among tagged tracks            -> ALBUM_DIVERGENCE
3. some tracks tagged, some not (album unanimous among tagged) -> ALBUM_MISSING
4. >1 distinct sanitized mbReleaseId among tracks carrying one:
     4a. exactly 1 distinct sanitized mbReleaseGroupId among
         tracks carrying one                                   -> MB_ALBUM_DIVERGENCE_RG_UNANIMOUS
     4b. otherwise                                             -> MB_ALBUM_DIVERGENCE
5. >1 distinct sanitized mbReleaseGroupId among tracks
   carrying one (release ids unanimous or all absent)          -> MB_RELEASE_GROUP_DIVERGENCE
6. otherwise                                                   -> no reason (clean)
```

Note ordering 2-before-3: a folder naming two albums *and* missing a tag reports
`ALBUM_DIVERGENCE`, the more informative failure. The spec's original ordering
(`ALBUM_DIVERGENCE, ALBUM_MISSING, ALBUM_INEXISTENT`) is preserved; `ALBUM_INEXISTENT` is checked
first only because it is the degenerate case of "no tagged tracks at all", where 2 and 3 are both
vacuous.

Single-track folders are trivially unanimous — that is correct and intended.

### API

```rust
pub struct TrackTags {
    pub id: String,                              // LocalReleaseTrack.id
    pub album: Option<String>,
    pub year: Option<i32>,
    pub mb_release_id: Option<String>,           // raw, as stored
    pub mb_release_group_id: Option<String>,     // raw, as stored
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub file_path: Option<String>,               // tiebreak for ordering only
}

pub struct Verdict {
    pub title: Option<String>,                   // first occurrence's ORIGINAL casing
    pub year: Option<i32>,
    pub mb_release_id: Option<String>,           // sanitized, unanimous or None
    pub mb_release_group_id: Option<String>,     // sanitized, unanimous or None
    pub reason: Option<&'static str>,
}

pub fn normalize_album(s: &str) -> String;
pub fn album_agreement(tracks: &[TrackTags]) -> AlbumVerdict;   // Unanimous(String)|Divergent|PartiallyMissing(String)|AllMissing
pub fn id_agreement<'a>(tracks: &'a [TrackTags], f: fn(&'a TrackTags) -> &'a Option<String>) -> IdVerdict; // Unanimous(String)|Divergent|Absent
pub fn year_agreement(tracks: &[TrackTags]) -> Option<i32>;
pub fn evaluate(tracks: &[TrackTags]) -> Verdict;
pub fn folder_leaf(path: &str) -> &str;
pub async fn mark_local_release_unknown(pool: &PgPool, id: &str, reason: &str) -> Result<(), sqlx::Error>;
```

- **`normalize_album`**: trim → NFC (`unicode_normalization::UnicodeNormalization::nfc`, already a
  workspace dep, `scripts/Cargo.toml:58`) → collapse internal whitespace runs to one space →
  `to_lowercase()`. **Do not reuse `common::mb::names::normalize_name`** (`mb/names.rs:30-44`): it
  NFD-folds accents, strips a leading `"the "` and drops punctuation — all far too loose here
  (`"Rêverie"` vs `"Reverie"` are different albums for this purpose, and must disagree).
- **`id_agreement`**: run `common::filters::sanitize_mb_id` (`filters.rs:8-16`, finds the first UUID
  anywhere in the string, lowercased) on each value before comparing — stored `mbReleaseId` is raw
  and real data includes case variants and garbage-wrapped ids. A value that sanitizes to `None`
  counts as untagged.
- **`year_agreement`**: one distinct year else `None`. **Never a status trigger.** Its only reader is
  the `status.rs:226-265` tie-break, whose `by_year` filter is soft
  (`.filter(|v| !v.is_empty()).unwrap_or_else(|| exact_matches.clone())`), so a `None` year degrades
  to CD-format-then-earliest-date rather than failing.
- **`evaluate`**: sort tracks by `(disc_number, track_number, file_path)` first; `title` is the
  first surviving occurrence's **original** casing (not the normalized form).

### `mark_local_release_unknown`

One transaction, two statements:

```sql
UPDATE "LocalRelease"
   SET "releaseId"    = NULL,
       "matchStatus"  = 'UNKNOWN'::"ReleaseStatus",
       "statusReason" = $2,
       title          = left(regexp_replace(COALESCE("folderPath", title), '^.*/', ''), 500),
       "updatedAt"    = NOW()
 WHERE id = $1
   AND "boxReleaseId" IS NULL
   AND "mediumPosition" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = "LocalRelease".id);

UPDATE "LocalReleaseTrack"
   SET "mbTrackId" = NULL, "updatedAt" = NOW()
 WHERE "localReleaseId" = $1 AND "mbTrackId" IS NOT NULL;
```

`LocalRelease.title` is `@db.VarChar(500)` — hence `left(..., 500)`. The guard mirrors
`mark_local_release_unmatched` (`sync/src/db.rs:987-1012`) plus the box-placement exclusions. Prefer
computing the leaf in Rust via `folder_leaf` and binding it, and keep the SQL guard as-is; the
`regexp_replace` form above is what the one-off SQL uses.

---

## 2. Prisma

`web/prisma/schema.prisma`, `model LocalRelease` (line 240-286), after `matchStatus`:

```prisma
  /// Why this release is UNKNOWN, in plain language (scripts/common/src/consensus.rs).
  /// Only ever set together with matchStatus = UNKNOWN, and never alongside a releaseId.
  /// Distinct from MusicBrainzRelease.statusReason (containment notes) — same name, different table.
  statusReason               String?                    @db.Text
```

**`@db.Text`, not `@db.Enum`** — the existing spec says `@db.Enum`, which is not a valid Prisma
native type for `String?`. (`MusicBrainzRelease.statusReason` at `schema.prisma:148` is a bare
`String?`; bare would drift from the `TEXT` the migration creates, so be explicit.)

Migration `web/prisma/migrations/20260920000000_local_release_status_reason/migration.sql`:

```sql
ALTER TABLE "LocalRelease" ADD COLUMN "statusReason" TEXT;
```

Sorts correctly after `20260919000000_user_api_keys`. **Never `db push`** — `web/.env`'s
`DATABASE_URL` is live NAS prod (192.168.1.241).

---

## 3. Index — `scripts/index/src/{db,main,deletion}.rs`

### Deletions
- `folder_majority_title_year` (`db.rs:63-93`) and its 3 tests (`db.rs:664` `..._picks_mode_album_and_year`,
  `:677` `..._ignores_empty_albums_and_falls_back`, `:686` `..._year_independent_of_album_mode`).
- The `folder_display_meta` block (`main.rs:1076-1098`) and its consumption (`main.rs:1203-1206`).

### `ensure_local_release` (`db.rs:116-145`)
Takes `status: &str` and `reason: Option<&str>` for the INSERT branch:
```sql
VALUES ($1,$2,$3,$7,false,0,0,$4,$4,$5,$6,$8)   -- matchStatus, statusReason now bound
```
The `ON CONFLICT ("groupKey") DO UPDATE` branch is **unchanged** — it already overwrites `title`
unconditionally on every run and only `COALESCE`s `year`, which is exactly why the DB-reading pass
below is required rather than a smarter upsert. `ensure_local_release_cached` (`db.rs:147-161`)
threads the two new args through.

### Brand-new folders
Per-folder `Verdict` over `extracted` seeds the INSERT:
- title = `verdict.title`, else `folder_leaf(strip_disc_subfolder(folder_path))`;
- `matchStatus` = `UNKNOWN` + reason when `verdict.reason.is_some()`, else `UNMATCHED` + NULL.

### New `apply_folder_consensus(pool, touched_release_ids) -> Result<ConsensusStats>`
Run **after** `batch_upsert_tracks` (`main.rs:1324`), reading tracks **from the DB**, not from
`extracted`. Reason this is load-bearing: `extracted` only holds new/changed files, and the
`release_cache` early return means existing rows were never re-evaluated — even under `--overwrite`.

Per release in `touched_release_ids`:
- Skip if box-placed or a member (`boxReleaseId IS NOT NULL OR mediumPosition IS NOT NULL OR
  EXISTS LocalReleaseMember`).
- `evaluate(db_tracks)`:
  - `reason.is_some()` → `mark_local_release_unknown(pool, id, reason)`, then set `year` from the
    verdict (unanimous or NULL).
  - `reason.is_none()` → set `title` = verdict title, `year` = verdict year. If the row previously
    had a `statusReason` (folder retagged into agreement) → also set `matchStatus = 'UNMATCHED'`,
    `statusReason = NULL` so sync picks it up again. A row that is already **bound** and agrees keeps
    its status untouched.
- Report counts per reason in the run summary.

**Module placement:** put `apply_folder_consensus` in `index::db` (or a new module registered in
`scripts/index/src/lib.rs`, which today exports only `canonicalize, db, deletion, resolve`).
`main.rs` is not reachable from an integration test, and `tests/album_consensus.rs` needs this
function.

### `deletion.rs:131-140`
The prune reset must also clear the reason, so a pruned release is an "UNKNOWN = rescore me" row
rather than a terminal one:
```sql
UPDATE "LocalRelease"
   SET "matchStatus" = 'UNKNOWN'::"ReleaseStatus", "statusReason" = NULL
 WHERE id = ANY($1::text[])
```
Rewrite the comment above it — the current text ("`statusReason` is a MusicBrainzRelease column, not
a LocalRelease one. Naming it here made the whole statement fail…") becomes factually false. Keep
the historical note, reworded: *the column now exists on both tables and means different things;
clearing it here is deliberate.* Leave the `.ok()` error-swallow as is (`tests/prune_guard.rs`
covers it).

---

## 4. Sync — `scripts/sync/src/{main,db,boxset,nuke}.rs`

### Row structs (`db.rs`)
- `LocalTrackRow` (`db.rs:2028-2042`) gains `album: Option<String>`, `year: Option<i32>`;
  `get_local_tracks_for_release` (`db.rs:2044`) adds `album, year` to its SELECT. Sync has no
  per-track album/year visibility today — this is what makes the gate possible.
- `LocalReleaseRow` (`db.rs:1950-1968`) gains `status_reason: Option<String>` and `is_folded: bool`;
  `get_local_releases_for_artist` (`db.rs:1970-2022`) selects `lr."statusReason"` and
  `EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id) AS is_folded`.

### The gate (`main.rs`, immediately after `main.rs:1429`)
Before **any** tier, and before any MB call:

```rust
let exempt = local_release.dissolved_bound_mb_id.is_some() || local_release.is_folded;
let verdict = consensus::evaluate(&consensus_tags_from_rows(&local_tracks));
if !exempt {
    if let Some(reason) = verdict.reason {
        consensus::mark_local_release_unknown(&pool, &local_release.id, reason).await.ok();
        r.skip(&format!("{} ({})", local_release.title, reason));
        continue;
    }
}
```

Exemptions explained (keep as comments): a **dissolved box disc** is still tagged with the box's ids
and its placement comes from the box pass, not from tags (same reasoning as the existing
`dissolved_bound_mb_id` special-casing at `main.rs:1436-1441`); a **folded** survivor legitimately
mixes per-disc album tags.

Tier 1/2 ids then come from the verdict, never a vote:
```rust
let tier1_release_id = local_release.dissolved_bound_mb_id.clone().or(verdict.mb_release_id.clone());
let tier2_rg_id      = verdict.mb_release_group_id.clone();
```

### Deletions (`main.rs`)
- `tags_agree_on` (`:282-305`), `get_majority_id` (`:307-319`), `majority_from_counts` (`:335-369`).
- Their tests (`:2403` `a_scatter_winner_is_not_an_agreement`, `:2411`
  `an_album_with_a_couple_of_odd_tracks_still_agrees`, `:2420`
  `untagged_tracks_do_not_count_against_agreement`, `:2428` `exactly_half_is_not_a_majority`,
  `:2471` `unanimous_single_id_wins`, `:2479` `single_track_single_id_still_wins`, `:2488`
  `all_distinct_count_one_is_no_consensus`, `:2496` `clear_plurality_wins`, `:2504`
  `tie_between_competing_ids_is_no_consensus`, `:2509` `empty_counts_is_none`) plus the `tagged()`
  helper at `:2381` — it enumerates all 9 `LocalTrackRow` fields and would break on the struct change
  regardless. Keep `is_artist_total_failure` and its tests.
- Tier 1's `agreed` (`:1467-1469`), the COMPLETE-rescue `confirmed` block (`:1482-1501`) and
  `weak_tags_rejected` (`:1452`, `:1583-1586`).
- The whole deluxe-upgrade block (`:1520-1568`). Consequence: a folder with more tracks than its
  tagged edition now scores `EXTRA_TRACKS` instead of hunting a bigger sibling. That is the honest
  answer and `stampMerged` already treats `EXTRA_TRACKS` as keepable, not a purge trigger.

### Tier 2 / Tier 3
Tier 2 (`:1573`) browses `tier2_rg_id` only. The Tier 1 404 fallback (`:1583-1586`) collapses to
"use the unanimous release id's group if Tier 1 404'd". Tier 3's gate (`:1652`,
`!has_embedded_ids`) is **unchanged** — it is now reachable only with a unanimous album title, which
is exactly the evidence a title search needs. Update the long comment at `:1640-1651`, which
currently explains the scatter-rejection rule that no longer exists.

### Status writers (`db.rs`)
- `update_local_release_match` (`:960-980`) also `SET "statusReason" = NULL`.
- `mark_local_release_unmatched` (`:987-1012`) also `SET "statusReason" = NULL`.

### `get_artists_pending_sync` (`db.rs:1826-1868`) — **critical**
```sql
OR EXISTS (SELECT 1 FROM "LocalRelease" lr
             JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
            WHERE lra."artistId" = a.id
              AND lr."matchStatus" = 'UNKNOWN'
              AND lr."statusReason" IS NULL)      -- <-- add
```
Without this a terminal UNKNOWN requeues its artist on every run, forever.

### Box pass (`boxset.rs`)
Both `majority_mb` subqueries — `find_sibling_groups` (`:938-940`) and `nested_groups`
(`:1041-1044`) — become unanimity tests, and the field is renamed `unanimous_mb_release_id`
(struct `SiblingRow` `:899-907`, consumers `:1649` log line and `:1686` `embedded_ids`):

```sql
(SELECT CASE WHEN count(DISTINCT t."mbReleaseId") = 1
             THEN min(t."mbReleaseId") END
   FROM "LocalReleaseTrack" t
  WHERE t."localReleaseId" = lr.id AND t."mbReleaseId" IS NOT NULL) AS unanimous_mb_release_id
```

The fold UPDATE (`:1348-1353`) and both dissolve UPDATEs (`:1429-1438`, `:1452-1461`) also
`SET "statusReason" = NULL` — box pairing is tracklist evidence, and it must be able to lift a
reason a previous pass set. Keep the existing `IS DISTINCT FROM` idempotence guards.

### `nuke.rs:60-61`
Comment only — same now-false "it is a MusicBrainzRelease column" claim.

### `tidy`
Check `scripts/tidy` / `dmp_sync`'s UNKNOWN re-score path and add an explicit
`AND lr."statusReason" IS NULL` guard. Our rows have `releaseId IS NULL` so a bound-release rescore
already misses them, but make it explicit so `--rescore-only --all` can never resurrect one.

---

## 5. Web (Tailwind utilities only, no `<style>` blocks)

| File | Change |
|---|---|
| `server/api/artists/[slug]/releases.get.ts:78-98` | add `statusReason: true` to the **LocalRelease** select (the nested MB selects at `:55`/`:150` already have it) |
| `server/api/releases/[id].get.ts:14-33` | same, on the local select (nested MB at `:48`/`:81` already has it) |
| `types/release.ts:101-117` | `LocalReleaseRow` gains `statusReason: string \| null`. `UnifiedRelease` (`:31`) already has it — no output-type change |
| `server/utils/releaseAggregation.ts:62-89` | the `!mbr` unbound branch omits the key entirely; add `statusReason: lr.statusReason`. Leave the matched (`:125`) and gap (`:269`) branches MB-sourced |
| `components/artist/ReleaseGroupDetails.vue:172` | **no change** — already renders `release.statusReason \|\| statusDescription(release.status)` |
| `components/ReleaseInfoDialog.vue` | new "Status reason" `dt`/`dd` row in the `<dl>` (opens `:131`), after the containment callout (`:132-138`) and before Year (`:139`), using `dtClass`/`ddClass` (`:66-67`), gated `v-if="release.statusReason && !containmentContainer"` |
| `helpers/constants.ts:314` | UNKNOWN description → `Not yet scored, or the files don't identify a single album.` |
| `server/utils/promote.ts` | use `statusReason` as the discard reason (`:302-309`); **add `statusReason: true` to the `reloaded` select at `:236`** (currently `{id, releaseId, matchStatus, forcedComplete}`) and branch on `!matched && reloaded?.statusReason`. Fix the stale deluxe-sibling comment at `:240-245` |

No collision with the MB column: a release carrying a consensus reason is never bound, so it never
has an `mbr`. The popover is `hidden md:flex` (desktop only) and suppressed during
searching/downloading/enriching/awaiting-merge — that is why the dialog row is the mobile surface.

---

## 6. One-off — `scripts/sql/oneoff_album_consensus.sql`

Style it after the only precedent, `scripts/sql/undo_owned_bundle_claims.sql`: header comment naming
the owning Rust module, prose cause, one paragraph per statement, read-only preview queries indented
under `--   `, guards commented inline with their observed row counts, `BEGIN;`/`COMMIT;`,
keyword-right-aligned, always `"updatedAt" = NOW()`.

### Shared CTE (same 6-way precedence as `consensus.rs`)

```sql
WITH t AS (
  SELECT lr.id AS lrid,
         lower(regexp_replace(btrim(normalize(tr.album, NFC)), '\s+', ' ', 'g')) AS alb,
         nullif(lower(substring(tr."mbReleaseId"      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rel,
         nullif(lower(substring(tr."mbReleaseGroupId" from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')), '') AS rg,
         tr.year AS yr
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" tr ON tr."localReleaseId" = lr.id
   WHERE lr."boxReleaseId"   IS NULL
     AND lr."mediumPosition" IS NULL
     AND lr."forcedComplete" = false
     AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
), agg AS (
  SELECT lrid,
         count(*)                                              AS n,
         count(*) FILTER (WHERE alb IS NOT NULL AND alb <> '')  AS n_alb,
         count(DISTINCT alb) FILTER (WHERE alb IS NOT NULL AND alb <> '') AS d_alb,
         count(DISTINCT rel) FILTER (WHERE rel IS NOT NULL)     AS d_rel,
         count(DISTINCT rg)  FILTER (WHERE rg  IS NOT NULL)     AS d_rg,
         count(DISTINCT yr)  FILTER (WHERE yr  IS NOT NULL)     AS d_yr,
         min(yr)                                                AS one_yr
    FROM t GROUP BY lrid
), verdict AS (
  SELECT lrid,
         CASE
           WHEN n_alb = 0            THEN 'No track in the release folder has an ''album'' metadata field'
           WHEN d_alb > 1            THEN 'Tracks in the release folder disagree in ''album'' metadata field'
           WHEN n_alb < n            THEN 'Some tracks in the release folder have no ''album'' metadata field'
           WHEN d_rel > 1 AND d_rg = 1 THEN 'Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID'
           WHEN d_rel > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz album id'
           WHEN d_rg  > 1            THEN 'Tracks in the release folder disagree on the embedded MusicBrainz release group id'
         END AS reason,
         CASE WHEN d_yr = 1 THEN one_yr END AS yr
    FROM agg
)
```

Note the CTE's album title for the *clean* rows is not needed — index owns titles; the one-off only
sets year on clean rows.

### Commented preview (run first, record the numbers)

```sql
--   SELECT v.reason, lr."matchStatus", count(*)
--     FROM verdict v JOIN "LocalRelease" lr ON lr.id = v.lrid
--    WHERE v.reason IS NOT NULL
--    GROUP BY 1,2 ORDER BY 1,2;
--   -- expect ~16,822 total: album disagree 14,688 / missing 19 / MB-id 2,115
--   -- (the 2,115 now splits three ways across reasons 4/5/6 — record the actual split)
--   SELECT count(*) FROM verdict v JOIN "LocalRelease" lr ON lr.id = v.lrid
--    WHERE v.reason IS NOT NULL AND lr."matchStatus" = 'COMPLETE';   -- expect 5,039
```

> **Ran 2026-09-23**: matched exactly — 16,822 total (14,688 / 4 / 15 / 2,020 / 95 / 0 across the six
> reasons in doc order), 5,039 `COMPLETE`. Final confirmed numbers + after-state:
> `docs/specs/spec_tidy_observations.md` §19.

> **Corrected 2026-09-23 — the `dmp` app container has no `psql` binary.** Every `docker exec dmp
> psql ...` below is wrong on this NAS; use the Postgres container instead
> (`sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp`, no `$DATABASE_URL` needed - the
> container already knows its own db/user). `./tidy` also needs `sudo` on this NAS (Kp isn't in the
> `docker` group, `docs/no_guessing.md`'s memory `reference_nas_docker_sudo.md` explains why) - the
> wrapper script itself calls plain `docker exec`, so run `sudo ./tidy ...`, not `./tidy ...`.

### Undo dumps (run on the NAS **before** Tx 1; no in-repo precedent, do it by hand)

**Skipped in the actual 2026-09-23 rollout** — a full `./backup` was taken immediately before Tx 1/Tx 2
instead and judged sufficient (no other writes expected in the window; a full-DB point-in-time restore
was an acceptable tradeoff against a scoped/no-downtime undo for this one run). Kept here for a future
rollout that wants the narrower, non-downtime undo path:

```bash
sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp -c "\copy (SELECT ...) TO STDOUT" > logs/undo20_album_consensus_releases.tsv
```
- `logs/undo20_album_consensus_releases.tsv` — `id, title, year, releaseId, mediumPosition, matchStatus`
  for every row the preview flags.
- `logs/undo20_album_consensus_links.tsv` — `LocalReleaseTrack.id, mbTrackId` for every track of
  those releases that currently has a link.

### Tx 1
- flagged rows: `releaseId = NULL`, `matchStatus = 'UNKNOWN'`, `statusReason = v.reason`,
  `title = left(regexp_replace(COALESCE("folderPath", title), '^.*/', ''), 500)`, `year = v.yr`.
- their tracks: `mbTrackId = NULL`.
- clean rows: `year = v.yr` (unanimous or NULL) only — do not touch title or status.

### Tx 2 — orphan MB-release sweep
Copy the **global** branch of `delete_orphaned_mb_releases` (`scripts/sync/src/db.rs:1243-1284`)
verbatim, keeping every guard: `m.status <> 'MISSING'`, no `LocalRelease.releaseId`, no
`LocalRelease.boxReleaseId`, no `LocalReleaseTrack → MusicBrainzReleaseTrack` pointing at it.
Without this the newly unbound MB releases linger as phantom gap cards, and `tidy --rescore-only`
does not run the sweep (`sync_decisions.md` §19 "Gaps in sync and tidy").

### Commented restore SQL
Reading both TSVs back into temp tables and reversing Tx 1 (`statusReason = NULL` included).

---

## 7. Docs

- **`CLAUDE.md`** — the "Embedded MB IDs are definitive… `>50%` of the tagged tracks
  (`sync/main.rs` `tags_agree_on`)" bullet (line 61) → unanimity + UNKNOWN-with-reason; add the
  folder-leaf display exception next to "Metadata is source of truth"; update the box-set bullet's
  "tag consensus" wording (line 36).
- **`docs/sync_decisions.md`** — §7 (rewrite the 4-tier list: no plurality, no COMPLETE-rescue, no
  deluxe upgrade), §9 (unanimous box id), §14 ("Embedded ids believed immediately — when files agree
  on them" → unanimity), §15 (new honest limit: round-7 internally-consistent wrong ids are still
  undetectable), §19 (mark item 9's 65 majority-bound CC rows as now UNKNOWN; note item 7 unchanged).
- **`docs/scripts/index.md:97`** — the majority-mode display paragraph.
- **`docs/scripts/sync.md`** — line 12 tier summary and the `### Consensus (get_majority_id)` section
  at `:142-143`.
- **`docs/scripts/tidy.md`** — the `--rescore-only` guard.
- **`docs/specs/spec_tidy_observations.md`** — new §19 "Round 8" (measurements, the reason split,
  undo20 file names, before/after library counts). **Do not renumber existing sections** — code
  comments cite them.
- **`docs/future.md`** — drop the `NEXT UP:` line.

---

## Rollout — done 2026-09-23

1. ✅ Implement. `cd scripts && cargo build --release && cargo test`;
   `cd web && pnpm test:unit && pnpm lint && pnpm typecheck`. (Ran via `cargo build --workspace` /
   `cargo test -p common -p index -p sync -p tidy -p add` and `npx vitest run` / `npx eslint .` /
   `npx nuxt typecheck` — all green: 273 Rust tests, 1909 web tests, 0 lint errors.)
2. ✅ Commit + push directly to `master`, no `Co-Authored-By` trailer — `0c7bcb3e`.
3. ✅ `./deploy` — migration + binaries. Ran clean (migration applied, container restarted).
4. ✅ `./backup` (chosen over undo dumps, see "Undo dumps" above) → one-off Tx 1 → Tx 2 →
   `sudo ./tidy --rescore-only --all`. Run from a NAS `tmux` session named `sync` (`ssh nas`,
   `tmux attach -t sync` to inspect). One-off executed via
   `sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp` — the `dmp` app container has no
   `psql` binary, see the correction above. Preview vs. post-run counts matched exactly; tidy
   re-scored 7,234 unrelated already-bound releases, 0 status changes, exit 0.
5. ✅ Updated `spec_tidy_observations.md` §19 Round 8 with the real counts.

Not done by this rollout (deliberately, not an oversight): the artist-page visual check
(Verification section below) — the user's own, per standing rule ("no self-login").

## Tests

- **`scripts/common/src/consensus.rs`** unit tests: case / spacing / NFC variants agree;
  `"X"` vs `"X (Deluxe)"` disagree; accented vs unaccented **disagree** (guards against reusing
  `normalize_name`); empty string = missing; partial-missing vs all-missing; ids — untagged don't
  veto, case- and garbage-wrapped variants agree after `sanitize_mb_id`, two ids disagree; the
  RG-unanimous sub-case yields reason 4 and the RG-divergent one reason 5; RG-only divergence yields
  reason 6; `year_agreement`; the full precedence ladder; first-occurrence casing; `folder_leaf`.
- **`scripts/index/tests/album_consensus.rs`**, following `scripts/index/tests/prune_guard.rs`:
  module doc with the exact run command, `SMOKE_TEST_DATABASE_URL` (never `DATABASE_URL`), fixture
  prefix constants, `reset_fixture` at both ends, `#[tokio::test] #[ignore]`. Cases: a bound
  disagreeing release is unbound with a reason + leaf title and its links cleared; a member /
  box-placed row is untouched; a retagged folder returns to `UNMATCHED` with the reason cleared;
  running twice is a no-op.
- **Sync**: an UNKNOWN-with-reason release does not make its artist pending; UNKNOWN without a reason
  still does.
- **Web**: `test/server/utils/releaseAggregation.test.ts` — add `statusReason` to the
  `localRelease()` factory (`:34`, needed for the type to stay complete) and assert the unbound card
  carries it (extend the test at `:89`); `test/components/artist/ReleaseGroupDetails.test.ts` — the
  `:172` popover text is currently untested, add it; `test/components/ReleaseInfoDialog.test.ts` —
  new row shown for a consensus reason, not shown when `containmentContainer` is set (extend the
  negative test at `:147`).
- Never bare `playwright test`; `pnpm test:e2e` only.

## Verification

- **Al Jolson**: the former "The World's Greatest Entertainer" / "In Songs He Made Famous" folders
  are UNKNOWN, reason set, folder-leaf titles, `releaseId` NULL. Artist page shows no bogus edition
  stacks, badge hover shows the reason — **visual check by the user; I don't self-login. Still
  pending as of 2026-09-23.**
  Expect "The Man and the Legend" ×3 to *survive* (round 7, out of scope) — don't report it as a
  regression.
- ✅ **Confirmed 2026-09-23, exact**: post-one-off counts match the preview exactly — 16,822 UNKNOWN
  with a reason, COMPLETE down 117,144→112,105 (-5,039). `docs/specs/spec_tidy_observations.md` §19.
- `./sync` twice: those artists are not pending; the second run is a no-op. Covered by
  `get_artists_pending_sync`'s `AND lr."statusReason" IS NULL` guard (code-level, not yet re-exercised
  against the live library post-rollout).
- Retag one folder into agreement → `./index --folders "Artist/Album"` → back to `UNMATCHED` →
  `./sync` binds it. Covered by `scripts/index/tests/album_consensus.rs`'s
  `retagged_folder_returns_to_unmatched_with_reason_cleared_and_is_stable` (`#[ignore]`d, needs
  `SMOKE_TEST_DATABASE_URL`) — not yet run against the live library.
