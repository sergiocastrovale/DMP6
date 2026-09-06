# Box sets & multi-disc releases — technical specification

Status: **in progress**. Started 2026-09-06. Resume from the checkboxes below.

This document is the working spec *and* the progress tracker for the box-set work. It is written to
be resumable from cold: everything needed to continue is here, including the MusicBrainz facts that
were verified against the live API, the prod-DB survey numbers, and the exact file/line anchors.

---

## 1. Why

Commit `98ac101c` ("fix: merge multi-disc releases by metadata, not folder names") made sibling disc
folders merge into one `LocalRelease` when their tracks agree on a majority embedded MB **release**
id and their disc numbers are disjoint. That is correct for a plain 2CD album and fixes 801 folder
groups. It does **not** handle box sets, and one of its own tests
(`index::db::keeps_a_box_set_of_separate_releases_apart`) encodes the wrong behaviour as intended.

### Goals

1. **A box set is its own discography entry** — one release, N discs.
2. **Each disc of a box is recognised as the same thing as the standalone album**, presented as an
   extra edition of that album marked as living in a box, and joinable for search/filter.

---

## 2. What MusicBrainz actually does (verified, not assumed)

All of the following was checked against `https://musicbrainz.org/ws/2/` on 2026-09-06.

### 2.1 A box set is ONE release with N media

There is **no box-set entity and no box-set release type** in MusicBrainz. Verified:

```
release 12b4461d-00d3-40b3-893c-684cc964eb3b  "The Complete Studio Recordings"
  packaging = "Other"   RG d786372d  primary Album, secondary [Compilation]
  9 media: 1 CD "Ring Ring" 19tr · 2 "Waterloo" 18 · 3 "ABBA" 14 · 4 "Arrival" 15
           5 "The Album" 11 · 6 "Voulez‐Vous" 16 · 7 "Super Trouper" 13
           8 "The Visitors" 16 · 9 "Rarities" 11

release 35a70166-074b-407d-b45b-1d12411296b1  "The Albums"
  packaging = "Other"   RG a9a2f2c5  primary Album, secondary [Compilation]
  9 media: 1 CD "Ring Ring" 12 · 2 "Waterloo" 11 · 3 "ABBA" 11 · 4 "Arrival" 10
           5 "The Album" 9 · 6 "Voulez‐vous" 10 · 7 "Super Trouper" 10
           8 "The Visitors" 9 · 9 "Bonus Tracks" 17
```

Both track-count vectors match the corresponding local folders exactly.

`packaging = 'Box'` is **not** a usable signal — 180 rows library-wide, and neither ABBA box uses
it. The only reliable marker of a box is **medium count > 1**.

### 2.2 MB stores NO link from a box to the standalone albums inside it

`GET /release/12b4461d…?inc=release-rels+release-group-rels` returns `relations: []`.

**Release group is not that link.** Release group means *editions/reissues of one album*:

```
The Albums (box)        release 35a70166  ->  RG a9a2f2c5 "The Albums"   Album [Compilation]
Ring Ring (standalone)  release ced05434  ->  RG 506764b9 "Ring Ring"    Album []
```

Seven different `Ring Ring` releases share RG `506764b9`. The box is its own release in its own RG.

### 2.3 The shared identity is the RECORDING

Medium 1 of both ABBA boxes and standalone release `ced05434` carry identical recordings, in order:

```
tr1 Ring Ring                    692a0e1e-0b76-47f1-b3f9-f70c15451979
tr2 Another Town, Another Train  49fa64ab-c150-403f-a7c7-e6cd013dc006
tr3 Disillusion                  473f8d54-5685-4122-a872-ab5da1eaecdf
tr4 People Need Love             5edf5416-9766-4ad7-9aa5-b8119f55da20
```

So the box↔album equivalence is **derivable from recording sets**. Crucially it costs **zero extra
API requests**: `inc=recordings` — which sync already requests at
`scripts/common/src/mb/api.rs:838` and `:787` — returns `track.recording.id` in the payload today.
We discard it. `MbTrack` has no `recording` field, and `MusicBrainzReleaseTrack.musicbrainzId`
holds the per-release **track** MBID, which cannot join across releases.

---

## 3. Current failure shapes

Prod-DB survey (read-only, 2026-09-06): 3064 disc-subfolder groups covering 10230 `LocalRelease`
rows. 801 groups are clean (one shared MB release id) and are fixed by `98ac101c`. 4460 local rows
bound to multi-medium MB releases currently read `MISSING_TRACKS`.

| shape | count | example | today's behaviour |
|---|---|---|---|
| **(a)** one disc mis-tagged | 50 groups / 219 rows | `ABBA/Compilation/2005 - The Complete Studio Recordings (9CD)` — CD1 tagged as standalone *Ring Ring* (`d228a88d`), CD2–9 tagged as the box, `discNumber` 1..9 disjoint | tier 1 merges 8/9 → box permanently `MISSING_TRACKS` + a stray duplicate *Ring Ring* card |
| **(b)** every disc tagged as its own album | 265 groups / 1143 rows | `ABBA/Compilation/2008 - The Albums (9CD)` — 8 folders tagged as the standalone albums, **all `discNumber = 1`**; only `2008 - Bonus Tracks` carries the box id at disc 9 | tier 1 merges **0** → 8 duplicate album cards + an orphan `Bonus Tracks` `MISSING_TRACKS` row |

Shape (b)'s `discNumber = 1` everywhere is the detail that forces `LocalReleaseMember` (§4.1) — the
disc numbering cannot come from the files.

### Decisions taken (by the user, 2026-09-06)

- **Rebind box discs to the box release**, overriding the files' embedded release ids. A deliberate,
  documented exception to CLAUDE.md's "MusicBrainz IDs are definitive": MB's own structure outranks
  a tag that contradicts it.
- **Equivalence rule**: recording-set equality, with a title + duration ±5s fallback for rows synced
  before `recordingId` exists.
- **UI**: box disc appears as an extra edition row inside the album's edition group, carrying a
  box marker; the box also stands alone in the discography with an `N discs` pill in the
  `info`/violet tone (amber = editions, red = MISSING).
- **Rollout**: sync is stopped. Do the whole job, commit, push, deploy, migrate, repair.

---

## 4. Design

Four pieces. No extra MusicBrainz requests anywhere.

### 4.1 Media become real rows + folds become sticky

`web/prisma/schema.prisma`:

```prisma
model MusicBrainzReleaseMedium {
  id                       String   @id @default(cuid())
  releaseId                String
  position                 Int
  title                    String?  @db.VarChar(500)
  format                   String?
  trackCount               Int      @default(0)
  // md5 of this medium's recording MBIDs, sorted. Equi-join key for the equivalence pass;
  // null until the release is re-synced with recordingId populated.
  recordingFingerprint     String?  @db.VarChar(32)
  // Derived by us, never sent by MusicBrainz: the release group this medium *is* an edition of.
  // Plain columns, not relations - `sync --link-box-editions` recomputes them wholesale, so a
  // stale value is corrected on the next pass rather than cascaded.
  equivalentReleaseGroupId String?
  equivalentReleaseId      String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  release                  MusicBrainzRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@unique([releaseId, position])
  @@index([releaseId])
  @@index([equivalentReleaseGroupId])
  @@index([recordingFingerprint])
}

model LocalReleaseMember {
  id             String       @id @default(cuid())
  localReleaseId String
  folderPath     String       @db.Text
  discNumber     Int?
  localRelease   LocalRelease @relation(fields: [localReleaseId], references: [id], onDelete: Cascade)

  @@unique([folderPath])
  @@index([localReleaseId])
}
```

Plus: `MusicBrainzReleaseTrack.recordingId String?` with `@@index([recordingId])`, and
`MusicBrainzRelease.mediumCount Int @default(1)` (denormalised — the artist releases endpoint is the
hot list route and must not join media just to render a disc count).

**Why `LocalReleaseMember` is not optional.** Shape (b)'s folders all carry `discNumber = 1`. If the
fold only lived in `LocalRelease`, the next `./index` would re-split those folders into `folder:`
rows and reset the disc numbers, churning the survivor row's identity — and its `FavoriteRelease` —
on every scan. With it, `index` looks a folder up by path *before* building a group key, reuses the
merged `LocalRelease`, and stamps `discNumber` from the member row. **No file tags are written**;
the disc numbering is a DB-side derivation from MB's medium positions.

Migration: hand-written at `web/prisma/migrations/20260907000000_box_sets/migration.sql`. Never
`db push` — the DB is shared prod. `./deploy` runs `prisma migrate deploy` in-container
(`docs/deploy.md:24`).

### 4.2 Rust — fetch what we already receive

`scripts/common/src/mb/types.rs`
- `MbMedia` gains `title: Option<String>` and `#[serde(rename = "track-count")] track_count: Option<u32>`.
- `MbTrack` gains `recording: Option<MbRecordingRef>`, with `struct MbRecordingRef { id: String }`.

`scripts/common/src/mb/api.rs`
- Extract `pub fn audio_media(media: &Option<Vec<MbMedia>>) -> Vec<&MbMedia>` and rebuild
  `flatten_audio_tracks` (`api.rs:752`) on top of it, so `allowlist::is_audio_medium` stays the
  single gate for both track flattening and medium rows.

`scripts/sync/src/db.rs`
- `MbTrackRow` gains `recording_id: Option<String>`, written by both `sync_mb_tracks_for_release`
  (`db.rs:243`) and `batch_insert_mb_tracks` (`db.rs:352`). `mb_track_key` is unchanged — the track
  MBID remains the per-release identity.
- New `sync_mb_media_for_release(pool, mb_db_id, &[MbMediumRow])`: upsert keyed on
  `(releaseId, position)`, delete positions no longer present. Same reconcile-rather-than-
  delete-and-reinsert discipline as `sync_mb_tracks_for_release`, so `equivalentReleaseGroupId`
  survives a re-sync.
- `upsert_mb_release` sets `mediumCount`.

Call sites that must persist media alongside tracks:
`scripts/sync/src/main.rs:1695` (bind path), `main.rs:1935` (catalogue-gap path),
`scripts/sync/src/owned.rs:185`, `scripts/sync/src/catalogue_gaps.rs:177`.

`format_from_media` (`main.rs:300`) stays as-is — display metadata, its sort+dedup is deliberate.
`mediumCount` is now the count source.

### 4.3 Rust — bind a box (tier 2)

New `scripts/sync/src/boxset.rs`, splitting a pure decision fn from the DB pass exactly as
`scripts/sync/src/multi_disc.rs` splits `plan_group` from `run_repair`.

Runs only on sibling folders under a common parent that tier 1
(`index::db::plan_disc_merges`) did **not** fold. Candidate box releases, in order:

1. the union of the siblings' own majority MB release ids — catches shape (a), where the dominant
   id's release turns out to have N media;
2. a title + artist search on the **parent folder's** display title, gated by the existing
   `common::mb::allowlist::is_allowed` — catches shape (b), where no sibling carries the box id.

Accept only on a **perfect matching**: the candidate has N audio media, the siblings are a subset of
them (a partially-ripped box is allowed), and each sibling maps to exactly one medium with equal
track count and per-track title match with duration ±5s — the same rule
`sync::owned::claim_owned_bundle` already uses (live re-recordings share titles). Any ambiguity —
two media a folder could equally be — rejects the whole group, exactly as `plan_group` already does
for a contested disc.

On accept, in one transaction:
- fold the siblings into one `LocalRelease`, `groupKey = "mbrelease:{box_mb_id}"`,
  `folderPath` = the common ancestor;
- set `releaseId` to the box;
- write one `LocalReleaseMember` per sibling with its medium position;
- relink each `LocalReleaseTrack.mbTrackId` to that medium's MB track;
- stamp `LocalReleaseTrack.discNumber` from the medium position;
- set `matchStatus = 'UNKNOWN'` so the next sync re-scores.

`scripts/index/src/db.rs`: `ensure_merged_local_release` and `ensure_local_release_cached` consult
`LocalReleaseMember` by folder path first.

The existing test `index::db::keeps_a_box_set_of_separate_releases_apart` asserts a premise now known
to be wrong (§2.1). Rewrite it to assert that tier 1 *defers* the group to tier 2.

### 4.4 Rust — derive the disc ≡ album equivalence (pure SQL, no API)

New sync mode `--link-box-editions [--dry-run]`, also run at the tail of `--repair-multi-disc` so one
command fixes a box end to end.

For every medium of every multi-medium release: compute `recordingFingerprint` = md5 of its sorted
recording MBIDs, then equi-join against the same fingerprint computed over whole single-medium
releases. On a hit, set `equivalentReleaseId` and `equivalentReleaseGroupId` from that release.

Fallback for rows synced before `recordingId` exists (which is all of them today, and all
single-medium albums until they are naturally re-synced): match the medium's
`(title, durationMs ±5s)` multiset against a single-medium release's. Same tolerance used elsewhere.

### 4.5 Web

- `web/types/release.ts` — `UnifiedRelease` gains `discCount: number | null` and
  `boxParent: { releaseId, title, mediumPosition, mediumTitle } | null`.
- `web/server/api/artists/[slug]/releases.get.ts` — select `mediumCount` and the new `media`
  relation (`position, title, format, trackCount, equivalentReleaseGroupId`). Note it currently
  selects `tracks: { select: { id: true } }` only.
- `web/server/utils/releaseAggregation.ts` — `buildReleaseCard` sets `discCount`; new
  `buildBoxEditionCards` emits one virtual card per medium carrying a non-null
  `equivalentReleaseGroupId`, using that RG as the card's `releaseGroupId` so it lands in the album's
  edition group with no change to the grouper.
- `web/composables/useArtistCatalogue.ts` — `buildGroups` needs no change (it keys on
  `releaseGroupId`, which the virtual cards already carry); add `discCount` to the group aggregate.
- New `web/components/artist/DiscsPill.vue` in the `info`/violet tone — accent-amber is taken by
  editions, danger-red by MISSING. Rendered by `ReleaseGroupRow.vue` when `primary.discCount > 1`.
  The marker-pill pattern now repeats a second time, so per CLAUDE.md promote it to a `markerPill()`
  recipe in `web/helpers/ui.ts` and refactor `EditionsPill.vue` onto it (boyscout rule).
- `web/components/artist/ReleaseGroupDetails.vue` — subtitle for a virtual box-edition card reads
  `disc {n} of {box title}`; disc headers inside the expanded track table when `discCount > 1`.

---

## 5. Task checklist

### Phase 1 — schema ✅ done 2026-09-06

- [x] Add `MusicBrainzReleaseMedium` to `web/prisma/schema.prisma`
- [x] Add `LocalReleaseMember` to `web/prisma/schema.prisma`
- [x] Add `MusicBrainzReleaseTrack.recordingId` + index
- [x] Add `MusicBrainzRelease.mediumCount` (default 1)
- [x] Back-relations on `MusicBrainzRelease` (`media`) and `LocalRelease` (`members`)
- [x] Hand-write `web/prisma/migrations/20260907000000_box_sets/migration.sql`
- [x] `pnpm prisma generate`; confirm no drift (**never** `db push`) — schema validated + client generated, migration NOT yet applied to prod (waiting for deploy step in Phase 8)

### Phase 2 — Rust: MB layer ✅ done 2026-09-06 (`cargo build --release` clean, no warnings)

- [x] `MbMedia.title` + `MbMedia.track_count` in `scripts/common/src/mb/types.rs`
- [x] `MbRecordingRef` + `MbTrack.recording` in the same file
- [x] `audio_media()` extracted in `scripts/common/src/mb/api.rs` (made `pub`, not `pub(crate)` — sync
      needs it too); `flatten_audio_tracks` rebuilt on it
- [x] `MbTrackRow.recording_id` threaded through `sync_mb_tracks_for_release` + `batch_insert_mb_tracks`
- [x] `MbMediumRow` + `sync_mb_media_for_release` + `mb_medium_rows()` builder in `scripts/sync/src/db.rs`
- [x] `upsert_mb_release_with_media()` writes `mediumCount`; plain `upsert_mb_release` now forwards to
      it with `medium_count = 1` so its ~10 existing callers are untouched
- [x] Persist media at the two call sites that actually fetch a tracklist: `main.rs:1695` (bind path)
      and `owned.rs:185` (owned-bundle claim). **Correction from the original plan**: `main.rs:1935`
      and `catalogue_gaps.rs:177` are the MISSING-placeholder stub paths — they call `upsert_mb_release`
      with `rg.id` as both release and release-group id and never fetch a tracklist, so there is no
      media to persist there. Left unchanged.

### Phase 3 — Rust: box binding ✅ done 2026-09-06 (`cargo test --release`: 299 passed, 29 ignored, 0 failed)

- [x] `scripts/sync/src/boxset.rs` — pure `plan_box_bind` + 7 unit tests (shape (a), shape (b),
      partial box, same-medium ambiguity, no-match rejection, single-sibling rejection, title-guess)
- [x] Candidate discovery: `candidates_from_embedded_ids` (siblings' own majority ids via
      `mb_get_release_by_id`) and `candidates_from_search` (parent-folder title via
      `mb_search_release_groups` + `mb_get_release_tracks`, gated by `allowlist::is_allowed`)
- [x] Perfect-matching acceptance (count + title + duration ±5s via `owned::normalize_title` /
      `owned::durations_compatible`, both widened to `pub(crate)`/reused rather than reimplemented),
      reject on ambiguity or a zero-match sibling
- [x] Transactional fold in `apply_box_bind`: discNumber stamped from medium position **before** tracks
      move to the survivor (their original `localReleaseId` is the only way to tell them apart once
      merged), `LocalRelease` groupKey/folderPath/releaseId/matchStatus update, `mbTrackId` relink via
      `sync_mb_tracks_for_release` + `link_local_tracks_to_mb`, one `LocalReleaseMember` row per sibling
- [x] Wired into `sync --repair-multi-disc` as tier 2, run immediately after `multi_disc::run_repair`;
      builds its own http client + `RateLimiter` there (every other `--repair-*` mode is deliberately
      network-free and returns before one exists). Honours `--dry-run` — prints the KEEP/merge table,
      writes nothing.
- [x] `index` consults `LocalReleaseMember` before building a group key: new
      `index::db::get_local_release_members()` (one query, small table, fetched once per index run)
      + a check in `main.rs`'s per-track loop, ahead of both `disc_merge_plan` and
      `build_group_key` — a folder already bound by `boxset::run_repair` is routed straight to its
      existing `LocalRelease` id, title/year left untouched. Closes the gap where a shape-(b) box
      (every disc tagged as its own standalone album, all reading `discNumber=1`) would otherwise be
      split back apart the next time `--overwrite`/`--prune` re-indexes those folders.
- [x] Rewrote `index::db`'s test as `defers_a_mis_tagged_box_disc_to_the_tier_2_matcher` — same
      assertions (tier 1's merge decision doesn't change), corrected doc comment: tier 1 leaving CD 1
      unmerged is a **blind spot**, not the correct final answer — MB has no box-set entity, a box IS
      one Release with N media (docs/box_sets.md §2). Also corrected the same wrong premise in
      `plan_disc_merges`'s own doc comment and in `multi_disc.rs`'s module header.

### Phase 4 — Rust: equivalence ✅ done 2026-09-06 (`cargo test --release`: 303 passed, 29 ignored, 0 failed)

- [x] `scripts/sync/src/box_editions.rs` — `recordingFingerprint` computed and persisted in the same
      SQL statement that consumes it (`link_by_recording_fingerprint`), not maintained incrementally
      on every sync — recomputing fresh each run avoids incremental-cache-invalidation bugs and this
      pass is cheap enough (one `UPDATE ... FROM` over two grouped CTEs) to just always re-run in full
- [x] `sync --link-box-editions [--dry-run]` mode + dispatch in `main.rs`
- [x] Exact recording-set equi-join: `md5(string_agg(DISTINCT "recordingId", ',' ORDER BY "recordingId"))`
      per medium vs. per single-medium release, joined on equal fingerprint; requires every track on
      both sides to carry a `recordingId` and ≥3 of them (reuses `owned::MIN_CLAIMABLE_TRACKS`'s
      reasoning: a 1-2 track match is far more likely coincidence than a shared recording set)
- [x] Title + duration ±5s fallback, **artist-scoped** (not library-wide - a box and the album it
      reprints are essentially always credited to the same artist, and 120k releases is too many to
      compare against directly): for each medium the exact pass left unlinked, fetch every
      single-medium release credited to that box's own artist(s) and match tracklists positionally
      via `owned::normalize_title` + `owned::durations_compatible` (both reused, not reimplemented).
      Ambiguous matches (more than one candidate release fits) are left unset rather than guessed.
- [x] Run at the tail of `--repair-multi-disc`, after `boxset::run_repair` — the newly-bound box's
      `MusicBrainzReleaseMedium` rows need to exist before there is anything to link. Also exposed
      standalone as `--link-box-editions` for re-runs without repeating the disc-binding pass.
- [x] `--dry-run` on the exact pass runs the same join as a `COUNT` instead of the `UPDATE`, so a
      preview touches nothing while still reporting an accurate number.

### Phase 5 — Web ✅ done 2026-09-06 (`vue-tsc --noEmit` clean; vitest unit+nuxt: 159 files, 1453 passed)

- [x] `UnifiedRelease.discCount` + `.boxParent` in `web/types/release.ts`, both optional (existing
      card literals across the codebase needed no changes); `MbReleaseRow` gains required
      `mediumCount`/`media` (the one test fixture constructing it — `releaseAggregation.test.ts`'s
      `mbRelease()` factory — updated to match)
- [x] `releases.get.ts` selects `mediumCount` + `media` on **both** the artist's own catalogue query
      and the appears-on query; same fields added to `server/api/releases/[id].get.ts`'s single-release
      lookup, which shares `buildReleaseCard` and would otherwise fail to type-check
- [x] `buildReleaseCard` sets `discCount = mbr.mediumCount > 1 ? mbr.mediumCount : null` (both the
      MB-matched and gap-card branches); the no-MB branch sets `discCount: null`
- [x] `buildBoxEditionCards` in `releaseAggregation.ts` — one virtual card per medium with a non-null
      `equivalentReleaseGroupId`, carrying that group as its own `releaseGroupId` (so the existing
      `releaseGroupId`-keyed grouper in `useArtistCatalogue.ts` needs **no changes at all** to place it
      in the right group — verified by a new test), `hasLocal: false`/`localTrackCount: 0` so it never
      renders as independently playable, and `boxParent` carrying the box's own title/medium position
- [x] **Correction from the original plan**: no `discCount` aggregate added to `ReleaseGroup`
      (`useArtistCatalogue.ts`) — `group.primary.discCount` is read directly at the render site
      (`ReleaseGroupRow.vue`), consistent with the existing convention of reading `group.primary.status`
      directly rather than duplicating fields onto the group. A box is always the sole member of its
      own release group in practice, so there was nothing to aggregate.
- [x] `markerPill()` recipe in `helpers/ui.ts` — `Record<Tone, {rule, tab}>` of literal per-tone class
      strings (Tailwind's static scan can't see through string-interpolated class names, so this can't
      be a template function); `EditionsPill.vue` refactored onto `markerPill.accent`
- [x] `components/artist/DiscsPill.vue` on `markerPill.info` (violet) — accent-amber is taken by
      editions, danger-red by MISSING
- [x] `ReleaseGroupRow.vue` renders `<ArtistDiscsPill>` when `isSingle && group.primary.discCount > 1`
- [x] `ReleaseGroupMultipleEditions.vue` — box-edition subtitle: `disc {n} of "{box title}"` in place of
      the usual disambiguation/editionLabel chip, via a new `editionSubtitle()` helper
- [x] **Descoped, not silently dropped**: disc headers in the expanded track table. The box's own card
      is the only one ever expandable with `discCount > 1` (a box-edition virtual card has
      `hasLocal: false` and never expands at all — the real audio lives on the box's card), and both
      product goals (box as its own entry; disc-as-edition search/filter) are fully met by the pill +
      virtual-card work above without it. `LocalReleaseTrack.discNumber` is already stamped correctly
      by `apply_box_bind`, so this remains a pure presentation add-on, not a data gap, if wanted later.

### Phase 6 — tests ✅ done 2026-09-06

- [x] `cargo test` — `boxset::plan_box_bind`: shape (a), shape (b), partial box, same-medium ambiguity,
      no-match rejection, single-sibling rejection, title-guess helper (7 tests, `scripts/sync/src/boxset.rs`)
- [x] `cargo test` — `box_editions::tracks_match`: exact-with-tolerance match, track-count mismatch,
      duration-outlier rejection, sub-3-tracks rejection (4 tests, `scripts/sync/src/box_editions.rs`).
      **Correction from the original plan**: no dedicated "`sync_mb_media_for_release` id stability"
      test was added — its reconcile-by-position discipline is a direct structural copy of
      `sync_mb_tracks_for_release`'s already-tested reconcile-by-key discipline (see that function's
      doc comment on why delete-and-reinsert was the actual bug), so a parallel test would duplicate
      coverage rather than add it.
- [x] `pnpm test:unit` — `buildBoxEditionCards` in `test/server/utils/releaseAggregation.test.ts` (3 tests)
- [x] `pnpm test:unit` — box-edition grouping + `discCount` in `test/composables/useArtistCatalogue.test.ts`
      (2 tests)
- [x] `pnpm test:unit` — `markerPill` coverage folded into the existing `test/helpers/ui.test.ts` tone-map
      describe block, rather than a separate `DiscsPill` component test — `DiscsPill`/`EditionsPill` are
      two-element presentational templates with no branching logic of their own (mirrors the codebase's
      existing convention: no test exists for `EditionsPill.vue` either); the thing actually worth
      protecting is the per-tone class-string data feeding both, which the new `markerPill` test does.
- [x] `pnpm test:e2e` run in full (75 tests via `pnpm build` + the disposable-test-DB harness — never
      bare `playwright test`): 74 passed, **1 pre-existing failure unrelated to this work** —
      `settings-autosave.spec.ts:28` looks for a "Show terminal sidebar" switch that commit `84dc227f`
      ("drop showTerminal setting", already on `master` before this task started) removed from the UI
      without updating this spec. Confirmed unrelated: no file this task touched is anywhere near
      `/settings/library` or the terminal sidebar. Flagged for the user rather than fixed, to keep this
      change's diff scoped to box sets.
- [ ] No dedicated e2e spec written for the discs marker / box-edition row — would need real box-set
      fixture data (a multi-medium `MusicBrainzRelease` + matching local files) in the e2e seed, which
      is a bigger lift than the unit/component coverage already in place. Left as a follow-up; the
      feature is covered end-to-end by the unit tests (`buildBoxEditionCards`, the grouping tests) down
      to the DOM-rendering boundary, just not through a real browser.

### Phase 7 — docs ✅ done 2026-09-06

- [x] `CLAUDE.md` data-model section: new bullet on box sets, the MB-verified facts (no box entity,
      no id-level disc→album link, recording is the shared identity), tier 1/tier 2 split,
      `LocalReleaseMember`, and the tag-override exception; also added `--repair-multi-disc` and
      `--link-box-editions` to the top-level Scripts command block (neither flag was listed there even
      before this change — `--repair-multi-disc` shipped in `98ac101c` without a CLAUDE.md entry either)
- [x] `docs/scripts/sync.md`: CLI usage examples + flags table for both flags, plus a new "Box Sets"
      section (after "Audio-only track counting", the adjacent media/discs topic) summarizing binding
      and equivalence and pointing to `docs/box_sets.md` for the full investigation
- [x] `docs/scripts/index.md`: new "Multi-disc folders and box sets" subsection under "Release
      Grouping" — tier 1/tier 2 split and why `get_local_release_members` must run before both
      `plan_disc_merges` and `build_group_key`
- [x] **Correction from the original plan**: no `docs/design_system.md` edit. That file turned out to
      be a dated migration-stage log (`## Artist page (Stage 5)`, etc.), not a live per-primitive
      catalogue — its own "Adding to the system" section states the rule explicitly: a utility string
      repeating a second time is promoted to `helpers/ui.ts` and documented *there*, which `markerPill`
      already is (its doc comment explains the Tailwind static-scan constraint and why each tone is a
      literal string rather than an interpolated one). Adding a bullet to a historical stage section
      would have misrepresented it as part of that redesign pass.

### Phase 8 — rollout

- [ ] `pnpm test:unit` green
- [ ] `cd scripts && cargo build --release && cargo test` green
- [ ] `pnpm test:e2e` green
- [ ] Visual check: run the app, screenshot ABBA's artist page (per `feedback_always_visual_check`)
- [ ] Commit + push
- [ ] `./deploy` (applies the migration via `prisma migrate deploy`)
- [ ] Backfill media + `recordingId`: re-sync **multi-medium releases only** (`max(discNumber) > 1` → 4659 releases, not all 120k)
- [ ] `./sync --repair-multi-disc --dry-run` → review KEEP/merge table → run for real
- [ ] `./sync --link-box-editions --dry-run` → review → run for real
- [ ] Verify in the DB: `The Albums` = one row, `COMPLETE`, 9 members; `The Complete Studio Recordings` = one row including the mis-tagged CD 1

---

## 6. Verification queries

```sql
-- the two ABBA 9CD boxes, after the repair
SELECT lr.id, lr."title", lr."matchStatus", lr."groupKey", lr."folderPath",
       (SELECT count(*) FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id) AS members,
       (SELECT count(*) FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id) AS tracks
FROM "LocalRelease" lr
WHERE lr."folderPath" LIKE 'ABBA/%(9CD)%';

-- media + derived equivalence for a box
SELECT m.position, m.title, m."trackCount", m."equivalentReleaseGroupId"
FROM "MusicBrainzReleaseMedium" m
JOIN "MusicBrainzRelease" r ON r.id = m."releaseId"
WHERE r."musicbrainzId" = '35a70166-074b-407d-b45b-1d12411296b1'
ORDER BY m.position;

-- how many disc-subfolder groups remain unfolded
WITH f AS (
  SELECT "folderPath", "releaseId", regexp_replace("folderPath",'/[^/]+$','') AS parent
  FROM "LocalRelease"
  WHERE "folderPath" IS NOT NULL AND array_length(string_to_array("folderPath",'/'),1) >= 4
)
SELECT count(*) FROM (SELECT parent FROM f GROUP BY parent HAVING count(*) > 1) s;
```

Baseline before the work: 3064 groups / 10230 rows; 4460 local rows bound to multi-medium MB
releases reading `MISSING_TRACKS`.

---

## 7. Out of scope (flagged, deliberately not fixed here)

`scripts/common/src/tags.rs:58` writes the **track** MBID into `ItemKey::MusicBrainzRecordingId`, so
`./sync --only-write-mb-to-files` has been stamping the wrong kind of id into audio files. Real bug,
but it is a file-writing change with its own blast radius and belongs in a separate commit.
