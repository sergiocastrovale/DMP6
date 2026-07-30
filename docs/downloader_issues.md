# Downloader — Technical & Architecture Audit

Audit of the download → merge → enrich → update-catalogue flow. Findings are ordered by
severity. Each is a checkbox task for follow-up. Evidence was gathered from the code and from
read-only queries against the live NAS DB (`192.168.1.241/dmp`) on 2026-07-30.

**Related docs:** `web/docs/feature_monitoring.md`, `web/docs/downloads_slskd.md`,
`web/docs/feature_rutracker.md`.

**Key files:** `web/server/utils/autoDownload.ts`, `monitorLoop.ts`, `promote.ts`, `acquire.ts`,
`acquireTorrent.ts`, `slskd.ts`, `downloadSources.ts`, `downloads.ts`;
`web/server/api/downloads/*`; `web/stores/downloads.ts`;
`scripts/sync/src/catalogue_gaps.rs`, `scripts/sync/src/db.rs`, `scripts/sync/src/main.rs`.

---

## Live-DB evidence (the smoking gun)

| Metric | Value |
|---|---|
| Total `DownloadedRelease` rows | **5,482** |
| Rows whose `mbReleaseId` no longer exists in `MusicBrainzRelease` (**dangling**) | **5,145 (94%)** |
| Distinct `mbReleaseId` collisions (>1 row on same id) | only **3** |
| `(artistId,title,year)` groups with >1 row | 51 groups = **5,110 rows** |
| `Primal Scream – Diamonds, Furcoat, Champagne (2008)` | **2,464 rows**, all dangling, spanning **39 days** |
| `Johnny Osbourne – Triple Dons 1` / `Wicked` | 1,259 / 1,242 rows |
| Artists with >100 rows | Primal Scream 2,556 · Johnny Osbourne 2,536 · Radiohead 170 |
| That album's rejections that came back | **455 "rejected by user"** |
| Rows currently stuck `ENRICHING` | **143** (all created in one 17-min window) |

The 2,464 rows for one album do **not** share an `mbReleaseId` (only 3 collisions exist in the
whole table). They are 2,464 *distinct* ids for the *same album*. That is the signature of the
root cause below.

---

## CRITICAL

### 1. Duplicate-download loop: dedup is keyed on the volatile `MusicBrainzRelease.id` cuid

- [ ] **Key the download↔release relationship on a stable MB identifier, not the internal cuid.**

**Symptom.** The system re-downloads (or re-attempts) the same album hundreds/thousands of times.
94% of `DownloadedRelease` rows are dangling garbage. Manual rejects reappear (455×).

**Root cause.** `DownloadedRelease.mbReleaseId` stores `MusicBrainzRelease.id`, which is a
`cuid()` regenerated on every INSERT (`scripts/sync/src/db.rs::upsert_mb_release` — `id` is only
set on INSERT; on `ON CONFLICT (musicbrainzId)` it is preserved, but the row is frequently
**deleted and re-inserted**, minting a fresh cuid). The delete+recreate happens on every
non-targeted sync:

- `scripts/sync/src/main.rs:1287` and `scripts/sync/src/catalogue_gaps.rs:101` call
  `delete_missing_releases_for_artist()` then recreate the MISSING placeholders.
- `promote.ts::stampMerged` deletes the MISSING placeholder on success
  (`prisma.musicBrainzRelease.deleteMany({ where: { id: row.mbReleaseId, status: 'MISSING' } })`).

Because the identity churns, **every downloader guard silently breaks**:

- `autoDownload.ts::pickFresh` — `AND NOT EXISTS (… dr."mbReleaseId" = mr.id)` no longer matches
  the old download row (old cuid), so the freshly-minted cuid looks never-downloaded → re-grab.
- `acquire.post.ts` "already in flight / promoted?" check (keyed on `mbReleaseId`) → defeated.
- `promote.ts::stampMerged` placeholder-retire → no-ops against a stale id → album stays MISSING.
- `delete_missing_releases_for_artist` protects `id NOT IN (SELECT mbReleaseId …)` — but the
  protection is also keyed on the volatile id, so an un-downloaded gap gets a new cuid every sync.
- `promote.ts::stampMerged` "already owned" (P2002 on `localReleaseId`) fires constantly because
  each new cuid produces a new download row for an already-present album.

**Proposed fix.**
1. Add a stable key to `DownloadedRelease` — store the MusicBrainz **releaseGroupId** (already
   denormalized as `releaseGroupId`, currently unused for dedup) and/or the stable
   `MusicBrainzRelease.musicbrainzId`, and make **all** dedup/guard/retire logic key on that:
   `pickFresh` NOT-EXISTS, `acquire.post` existing-check, `stampMerged` retire, torrent sibling
   check (`acquireTorrent.ts`). `mbReleaseId` (cuid) may stay only as a soft pointer.
2. Prefer **release-group granularity** for "is this album already handled?" — a local album
   matches one edition; sibling editions of the same group must not each be a separate target.
3. When retiring on promote, resolve the current MISSING placeholder(s) by `releaseGroupId`, not
   by the possibly-stale cuid.

Files: `web/prisma/schema.prisma` (migration), `autoDownload.ts`, `acquire.post.ts`, `promote.ts`,
`acquireTorrent.ts`, and the Rust `delete_missing_releases_for_artist` guard
(`scripts/sync/src/db.rs`).

---

### 2. Rejection / abandonment is not durable

- [ ] **Make "rejected", "abandoned", and the attempts cap survive an MB-release recreate.**

**Symptom.** The user rejected one album **455 times** and it kept coming back. `ABANDONED` (the
terminal cap) is almost never reached in practice for the churning albums.

**Root cause.** Same identity churn as #1. Reject/abandon writes a terminal status on the *current*
cuid's row. The next sync recreates the placeholder with a new cuid that has no row → `pickFresh`
re-grabs it, `attempts` resets to 0, and the terminal tombstone is orphaned. The attempts cap
(`maxDownloadAttempts`) is effectively defeated.

**Proposed fix.** Depends on #1. Once dedup is keyed on `releaseGroupId`/`musicbrainzId`:
- Reject/abandon must set a durable tombstone on the stable key so `pickFresh`/`pickRetry` exclude
  the whole release group, not one ephemeral row.
- Consider a dedicated column (e.g. `suppressedUntil` / `rejectedGroup`) or an exclusion table so a
  user "reject" is honored across recreates.

Files: `promote.ts` (`applyRejectionCap`, `rejectDownloadedRelease`), `autoDownload.ts`
(`pickFresh`/`pickRetry` exclusion).

---

### 3. No garbage-collection of dangling / terminal download rows

- [ ] **Add a sweep that deletes (or archives) `DownloadedRelease` rows whose target is gone.**

**Symptom.** 5,145 dangling rows (94% of the table). `queue.get.ts` loads thousands of them on
every poll (see #8). History/failed/unavailable tabs are unusable.

**Root cause.** Nothing ever deletes a `DownloadedRelease` once its `MusicBrainzRelease` is gone.
`cleanupReadyDownloads()` only sweeps `READY` rows with missing staged files — not dangling
terminal rows.

**Proposed fix.** Periodic (or on-demand `cleanup`) sweep:
- Delete terminal rows (`UNAVAILABLE/FAILED/INVALID/ABANDONED/REJECTED`) whose `mbReleaseId` no
  longer resolves to a live `MusicBrainzRelease` **and** whose release group is no longer MISSING.
- One-off migration/cleanup for the existing 5,145 rows.
- Guard so it only runs where the DB is authoritative (it always is — DB is shared).

Files: new sweep in `monitorLoop.ts` or `promote.ts`; wire into `api/downloads/cleanup.post.ts`.

---

## HIGH

### 4. Every edition of a release group is a separate download target

- [ ] **Deduplicate acquisition by release group so sibling editions aren't grabbed separately.**

**Symptom / risk.** `pickFresh`/`pickRetry`/`missingReleasesForArtist` select MISSING rows at the
individual `MusicBrainzRelease` (edition) grain. `catalogue_gaps.rs` currently writes one MISSING
per release *group* (mitigating this today), but the regular sync path and any per-edition MISSING
creation reintroduce multiple MISSING rows for one album, each independently downloadable.

**Root cause.** No release-group-level "already have / already trying" gate in the picker.

**Proposed fix.** Add a `releaseGroupId` NOT-EXISTS/aggregation guard to `pickFresh`, `pickRetry`,
and `missingReleasesForArtist` (torrent) so at most one active target per group. Ties into #1.

Files: `autoDownload.ts`, `acquireTorrent.ts`.

---

### 5. `settleFinished` leaves the row `DOWNLOADING` if `moveToReady` throws

- [ ] **Set a definite state before/after move; don't strand a finished download as DOWNLOADING.**

**Symptom.** A finished download whose `moveToReady` fails (e.g. transient FS error, misconfig)
stays `DOWNLOADING` with files already relocated. Next reconcile finds no source files
(`movedCount === 0`) → `failAttempt` → `FAILED`, even though the files are present in staging → it
gets re-downloaded.

**Root cause.** `monitorLoop.ts::settleFinished` updates only `stagingPath`+`error`, then calls
`moveToReady(id).catch(log)`. If `moveToReady` throws, status is never advanced past `DOWNLOADING`.

**Proposed fix.** Make finalization atomic per row: set an intermediate/READY state that reflects
"files staged, transfer done" so a failed move doesn't re-enter the transfer-finalize path. On
`moveToReady` failure, mark a distinct recoverable state (not silently swallowed).

Files: `monitorLoop.ts`, `promote.ts::moveToReady`.

### 6. slskd relocate matches files by basename across the entire downloads root

- [ ] **Scope slsk relocation to this download's files, not a whole-tree basename search.**

**Symptom / risk.** `slskd.ts::relocateDownloadedFiles` locates files via
`findFilesByBasename(downloadsPath, expected, 10)` — a 10-deep walk of the whole downloads root.
Two concurrent slsk downloads that share a track basename (`01 - Intro.flac`, `Track01.mp3`) can
capture each other's files, producing wrong/mixed folders. Torrents avoid this via `scanRoot`; slsk
passes no `scanRoot`, so it defaults to the whole root.

**Root cause.** No per-transfer source directory for slsk; matching is basename-only and global.

**Proposed fix.** Record the actual slskd download subfolder (or match on
`username`+relative-path, not bare basename) and pass a scoped `scanRoot`. At minimum, restrict the
walk to the peer/album subtree and de-duplicate on full relative path.

Files: `slskd.ts` (`relocateDownloadedFiles`, `findFilesByBasename`), `acquire.ts`.

### 7. `findBestSlskdResult` doesn't verify the result is the requested album

- [ ] **Validate that the chosen slsk result actually matches artist+album before enqueuing.**

**Symptom.** `acquire.ts::findBestSlskdResult` picks the highest *quality/speed*-scored folder from
a free-text `"artist album"` search with no check that the folder/files correspond to the requested
release. Wrong albums get downloaded + transcoded, then discarded later by the sync validation
(`INVALID`, "no MusicBrainz identity"). Evidence: 246 "no MusicBrainz identity after enrichment"
for one album. Wasted bandwidth + CPU (transcode) + churn.

**Root cause.** `scoreSlskdResult` scores format/bitrate/speed/queue only — not title similarity.

**Proposed fix.** Add a title/artist similarity gate (reuse `torrentMatch.ts::normalizeTitle`) so a
result must plausibly match the release folder/filenames before it's accepted; reject otherwise.

Files: `downloads.ts::getSlskdResults` / `acquire.ts::findBestSlskdResult`, `slskd.ts::scoreSlskdResult`.

---

## MEDIUM

### 8. `/api/downloads/queue` returns the full active set unbounded

- [ ] **Paginate/limit `active` (and history) in `queue.get.ts`.**

**Symptom.** `queue.get.ts` `active` selects **all** `DOWNLOADING/ENRICHING/FAILED/ABANDONED/
UNAVAILABLE` rows with no `take`. With ~4,900 such rows (mostly dangling), every 2s poll ships
thousands of rows + a batched MB-type lookup over all their ids. `history` is capped at 200; `active`
is not.

**Root cause.** No limit on the `active` query; relies on the set being small.

**Proposed fix.** Cap and paginate `active` per tab; return counts separately. Combine with the GC
in #3 so the set is small to begin with.

Files: `queue.get.ts`, `stores/downloads.ts`, the downloading/failed/unavailable tab components.

### 9. Enrichment (SongKong) rows pile up and stall

- [ ] **Detect a down/backed-up SongKong drainer and stop spooling into ENRICHING.**

**Symptom.** 143 rows currently `ENRICHING`, all created in one 17-min window; 95 "SongKong
enrichment timed out; merged without enrichment" for a single album. If the host drainer is
down/slow, rows sit in `ENRICHING` until the per-row max-wait, keeping `hasInFlight` true (poll
never rests) and delaying READY.

**Root cause.** `monitorLoop.ts` unconditionally spools to `ENRICHING` when
`resolveSongkongEnabled()`; there's no liveness/back-pressure check on the drainer, and the timeout
is per-row (so a burst all waits the full window).

**Proposed fix.** Track drainer liveness (heartbeat / spool backlog size); when unhealthy, either
skip enrichment (go straight to READY) or cap the ENRICHING backlog. Surface it in the idle banner.

Files: `monitorLoop.ts` (`reconcileDownloads`, `drainEnriching`), `songkongSettings.ts`.

### 10. INVALID discard deletes the library folder, then re-downloads forever

- [ ] **Don't purge + re-fetch a copy that will never validate; cap by release group.**

**Symptom.** `stampMerged` deletes the library folder + `LocalRelease` and marks `INVALID` when the
merged copy has no MB identity / isn't a COMPLETE match. Combined with #1, a source that never
carries MB-tagged copies (e.g. reggae comps — Johnny Osbourne) loops: download → INVALID → purge →
recreate placeholder → download again. 247 `INVALID` for one album.

**Root cause.** Validity gate requires embedded-MB-tag COMPLETE match; the attempts cap that should
stop this is defeated by the identity churn (#1/#2).

**Proposed fix.** After #1/#2, ensure INVALID counts against a durable per-group cap so a
never-matchable release is abandoned for good. Optionally keep an unmatched-but-plausible copy
instead of purging (user decision), rather than deleting and re-fetching indefinitely.

Files: `promote.ts::stampMerged`.

### 11. Manual acquire uses `artistId: ''` for year-less releases

- [ ] **Don't write an empty-string `artistId`; use null or the real artist.**

**Symptom.** `acquire.post.ts` (year==null branch) creates a row with
`artistId: mb.artists[0]?.artist?.id ?? ''`. An empty string is not a valid FK and not null;
`artist` relation lookups then silently return nothing and the row is hard to attribute.

**Root cause.** `?? ''` fallback instead of `?? null` (the column is `String?`).

**Proposed fix.** Use `?? null`.

Files: `acquire.post.ts:32`.

### 12. `mergeSelected` fans out N individual index+sync spawns

- [ ] **Route multi-select merge through the batched `mergeManyDownloadedReleases` path.**

**Symptom.** `stores/downloads.ts::mergeSelected` does `Promise.all(ids.map(merge))`, i.e. one
`merge/[id]` (→ one `index --folders` + one `sync --release`) per row. `mergeManyDownloadedReleases`
already exists to do one index pass + deduped sync. The per-row path is far slower and serializes
on the Rust lock anyway.

**Root cause.** Multi-select reuses the single-row endpoint instead of the batch endpoint.

**Proposed fix.** Point `mergeSelected` at `merge-all` with the selected ids (it already accepts
`ids`).

Files: `stores/downloads.ts`.

---

## LOW / correctness edge cases

### 13. `getSlskdActiveDownloads` timeout is swallowed as "no transfers"

- [ ] **Distinguish "slskd unreachable" from "no active transfers" in reconcile.**

**Symptom.** In `reconcileDownloads`, `withTimeout(getSlskdActiveDownloads(), 15s).catch(() => [])`
returns `[]` on timeout. Empty transfers for a row with files ⇒ "all terminal" ⇒ it finalizes /
fails based on disk state. A transient slskd outage can therefore prematurely fail live downloads.

**Proposed fix.** On fetch failure (vs genuine empty), skip finalization this tick instead of
treating every download as terminal.

Files: `monitorLoop.ts`.

### 14. `chooseSource` can strand a release when RuTracker budget is spent and Soulseek is off

- [ ] **Confirm intended behavior when only RuTracker is enabled and its daily budget is spent.**

**Symptom.** `chooseSource` returns `null`; `topUpDownloads` `continue`s and the monitor idle-gate
(`downloadWorkPossible`) pauses acquisition until the RT window rolls. This is intended, but the
release's row (if freshly created before the source check) — verify no half-created rows are left.
`topUpDownloads` checks source *after* pick but *before* row creation, so it's fine; document it.

**Proposed fix.** Add a test asserting no row is created when `chooseSource` returns null.

Files: `autoDownload.ts`, test.

### 15. `year IS NOT NULL` filter permanently excludes date-less release groups

- [ ] **Decide policy for release groups MusicBrainz has no date for.**

**Symptom.** `pickFresh`/`pickRetry` require `mr.year IS NOT NULL`, and `moveToReady`/`acquire.post`
treat year-less releases as "erroneous". Legitimate releases with no MB first-release-date are never
acquirable. Acceptable, but should be a conscious policy (and surfaced, not silent).

**Proposed fix.** Either backfill year from the earliest edition, or surface these as a distinct
"cannot acquire (no date)" bucket rather than silently skipping.

Files: `autoDownload.ts`, `acquireTorrent.ts::missingReleasesForArtist`, `promote.ts::moveToReady`.

### 16. Torrent sibling-fulfilment check keyed on `mbReleaseId` (volatile)

- [ ] **Use the stable key for the "sibling already handled?" check in `acquireTorrent`.**

**Symptom.** `acquireTorrent.ts` skips a pack sibling if a row exists with `mbReleaseId = m.release.id`
in an ACTIVE status. Same volatile-id problem as #1 → a pack can re-download a sibling already had.

**Proposed fix.** Key on `releaseGroupId`/`musicbrainzId` (ties into #1).

Files: `acquireTorrent.ts`.

---

## Suggested fix order

1. **#1** (stable identity) — unblocks #2, #4, #10, #16 and stops the bleeding.
2. **#3** (GC) + one-off cleanup of the 5,145 dangling rows.
3. **#2** (durable reject/abandon), **#4** (group-level dedup).
4. **#5, #6, #7** (finalization + file-matching + result validation correctness).
5. **#8, #9** (UI/perf + enrichment back-pressure).
6. Remainder (#10–#16).

> Note: #1 needs a Prisma schema migration (shared NAS↔local DB) — per project policy, coordinate a
> deploy for that change. Most other fixes are web-only and stop at typecheck + tests.
