# Spec: containment ≠ ownership — rollout (done)

**Status: complete, verified on prod 2026-09-10.** Describes code as of that date — box pass has since moved from sync's tail into `./tidy` (`docs/scripts/tidy.md`), file/line refs are stale. Current behavior: `docs/sync_decisions.md` §9/§12. Companion data model rule: `CLAUDE.md` "Containment ≠ ownership".

## Problem
`owned::claim_owned_bundle` (old): if every track of MB release A was found inside one bigger local release, marked A `COMPLETE` with `statusReason='Owned as part of "<folder>"'`, linked the container's local tracks to A's MB tracks, rejected any queued download for A. Wrong on two counts:
1. **Not ownership** — a box set/compilation's rendition of an album is a different edition/master. Live library: 1,585 releases falsely marked owned, removed from the MISSING acquisition pool.
2. **Corrupted track identity** — `link_local_tracks_to_mb` overwrites unconditionally, so it repointed the *container's own* tracks at the claimed release's MB tracks: 11,178 `LocalReleaseTrack` rows ended up with `mbTrackId` belonging to a release other than the one their `LocalRelease` is bound to → `sync --only-write-mb-to-files` would write mismatched album/track id pairs into files.

## Fix
Replaced with `owned::detect_containment` — read-only, same matching rule (title match ±5s, strict superset, ≥3 tracks). Contained release stays `MISSING`/gap/downloadable, gets `statusReason='Recordings inside "<container>"'`. No track links, no file writes, no queue rejections. Web renders via `containmentContainerTitle()`.

## Rollout order (why it matters)
1. Gated on multidisk (box-set) work landing first — `boxset::run_repair` fires once at the tail of the whole sync run, so `boxReleaseId`/`mediumPosition`/`LocalReleaseMember` are legitimately zero rows mid-run; nothing to validate until it's done.
2. **`scripts/sql/undo_owned_bundle_claims.sql` hardened against box provenance (§2.2, still cited by the SQL file's own comment):** `boxset.rs` deliberately links a dissolved disc's local tracks to the *box's* MB track rows while `LocalRelease.releaseId` points at the standalone equivalent — same shape (`mt.releaseId <> lr.releaseId`) the undo's 2nd statement targets. Both undo statements need `AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr2 WHERE lr2."boxReleaseId" = <the MB release>.id)` or the undo can flip a box release back to `MISSING` and null links multidisk just derived.
3. Deploy the new binary **before** running the undo SQL — the old binary re-mints a claim for every artist it syncs, so an undo against the old image gets undone by the next sync.
4. Capture affected artist ids before the UPDATE (for the relink re-sync step) — file mounted at both `/mnt/SSD/web/dmp/logs/relink-artist-ids.txt` (host) and `/app/data/logs/relink-artist-ids.txt` (container), don't swap them.
5. `./backup` first — mutates ~1.6k release rows, ~11k track rows.
6. Run hardened undo SQL: statement 1 flips claims back to `MISSING` gaps with the new containment wording (also protects them — `delete_orphaned_mb_releases` only deletes `status <> 'MISSING'`); statement 2 nulls mis-pointed `mbTrackId`s (scoped, excluding box-referenced rows).
7. Relink re-sync: `sync --artist-ids <captured file>` rebinds nulled links from each release's own matched tracklist via the ordinary bind path. MB-rate-limited, hours-long, resumable via `syncRunHash`.

## Verified result (2026-09-10)
- `Owned as part of%` claims: **0** (was 1,700).
- `Recordings inside "%"` notes: **2,037**.
- Box-set state untouched by the undo: 133 dissolved discs, 393 fold members.
- Remaining cross-release `mbTrackId` mismatches are all dissolve-authored (`N of M discs present`) — none carry a containment/ownership `statusReason`.
- UI pass (Nina Simone — `Gifted & Black` inside `Ne me quitte pas`): greyed gap row, muted badge linking to container, working Download action, not shown as owned.

## Side effect
Undo returned ~1,600 releases to the `MISSING` acquisition pool — with monitoring on, the download trickle worker starts acquiring standalone editions for them. Expected, but check `Settings → Downloads` if the queue shouldn't grow that much at once.

## Rollback
Undo SQL is two `UPDATE`s in one transaction, no deletes — reversible only by restoring the pre-undo `./backup` (old mis-pointed values aren't recorded anywhere to hand-restore). The code change is independently revertable: `detect_containment` writes nothing, so reverting the binary alone just stops notes from refreshing.

## Cleanup done
`./repair-box-sets` (one-off backfill binary) and its `CLAUDE.md`/`docs/scripts/sync.md` mentions removed 2026-09-10.
