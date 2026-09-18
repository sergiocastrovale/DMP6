# Spec: tidy rollout — post-run analysis (2026-09-18)

Investigation log from the first full `./sync`+`./tidy` rollout (`docs/specs/spec_tidy_script.md` Step 10) through 6 follow-up rounds, all on 2026-09-18. Numbers below are point-in-time prod measurements. Section numbers are cited by code comments (`boxset.rs`, `db.rs`, `title_rules.rs`, `tidy/main.rs`, `main.rs`) — **do not renumber sections**.

## 1. Round-1 result

```
Tidy complete. (6h:38m:07s)
Box groups: 2857 seen, 1420 bound (1192 folded, 223 dissolved, 5 key-taken, 0 failed)
Re-scored: 1901 complete, 96 missing tracks, 57 extra tracks
```

Fold/dissolve correct wherever it fired, nothing written was wrong — but roughly half the box groups seen were never bound, and the summary gave no way to tell why. Verified clean: 0 box-placed discs stuck at `UNKNOWN`; 0 `Box-set repair error`s (error boundary held); lock heartbeat confirmed in prod (stale-lock never stolen mid-run); 0 folds with a NULL `discNumber`.

## 2. Case studies
- **HIM "The Single Collection"** (the case that triggered the investigation): 10 identical cards → folded correctly into 1 release, 10 `LocalReleaseMember` rows, `COMPLETE`.
- **ABBA "The Complete Studio Recordings" (9CD)**: 6 of 9 discs dissolved onto their standalone albums correctly (box provenance kept via `boxReleaseId`/`boxMediumPosition`; `EXTRA_TRACKS` on them is honest — box has bonus tracks). CD1/CD4 wrongly stayed stuck on the box despite having obvious standalone twins — root cause: `resolve_containment_winner` refused a tie between 4 `Arrival` candidates that all shared one `releaseGroupId`. Fixed in round 2 (§ below) via release-group tie-break.

## 3. Bug 1 — one bad track kills an entire box (dominant failure mode)
`pair_tracks` required exact 1:1 resolution of every sibling folder to a medium; one non-matching track refused the **whole group**. Proof: Marillion 12-disc box, 11 discs matched perfectly, CD4 "(alternative version)" vs. MB "(re-record)" — title disagreement, not a truncation bug — refused the entire box.

Replayed against all 263 genuine unplaced boxes (920 rows): 220 groups had exactly one sibling failing (126 of those single-bad-folder). Root causes of the 126: duration-only kills within tolerance (37, mostly fixable by widening pass 1b), genuinely different titles needing fuzzy matching (29), containment blocked by too-tight duration window (13, cheapest fix — align with 15s pass-1b window), track-count mismatch needing partial bind (39), no free medium (9).

## 4. Bug 2 — MB lookup failures are silent, then permanent
Lookup errors were swallowed (`reporter.sub_step` only, no log, no retry, no failure counter) — a transient 503 looked identical to "no box release exists". Worse: **phase 10 stamped the watermark regardless**, so a plain `./tidy` never revisited affected artists. Evidence: 4 groups (Pixies "Doolittle 25", Thunder "Rip It Up", Hawkwind "Levitation", IQ "The Wake") bound cleanly on live re-fetch but sat unplaced and stamped done. Fixed in round 2: logged + counted, artists whose group hit a fetch error excluded from the stamp.

## 5. Bug 3 — 1,336 stale `mbTrackId` links
Local tracks pointing at a `MusicBrainzReleaseTrack` belonging to a different release than their own `LocalRelease.releaseId` — 1,336 links across 122 releases, 105 of them dissolved box discs. Cause: `rescore_bound_release` re-links correctly, but `get_rescore_targets` only picked `matchStatus='UNKNOWN'` rows or this run's touched ids — a disc dissolved and scored by the pre-tidy sync-era box pass fell into neither set, so its stale links were never reconciled. Inherited from the Sep 9/10 rollout, not caused by tidy. Fixed in round 2: re-score targets extended to any release whose track links point outside its own release.

## 6. Bug 4 — the summary hides the failure mode
`groups_seen`/`bound` gave no breakdown of *why* the other ~1,400 groups didn't bind — every skip path was `reporter.skip` only, nothing counted, nothing logged. Fixed in round 2: counters broken down by `no_candidate`/`candidate_fetch_failed`/`plan_refused_no_match`/`plan_refused_ambiguous`/`plan_refused_collision`.

## 7. Equivalence coverage — an undocumented ceiling
Only 14.7% of box-disc media had any equivalence set; 42.5% of single-medium releases can't serve as a tier-1 (recording-fingerprint) equivalence target because at least one track has no `recordingId`. This is the structural reason round 1 folded 1,192 groups but only dissolved 223 — most standalone twins simply can't be recognized via tier 1. A `recordingId` backfill would move dissolve rates more than any matcher tweak (open, not done).

## 8. Other observations
- 215 artists had `lastTidiedAt` set but `lastSyncedAt` NULL — not a bug: identity-repair passes B/C null `lastSyncedAt` to requeue for sync, phase 10 then stamps `lastTidiedAt` on the whole scope anyway. Documented in `docs/scripts/tidy.md`.
- 230 groups / 1,113 rows were fully placed yet still re-discovered and re-fetched from MB on every unscoped run (fixed round 2: skip already-placed groups, but still check for new equivalences via `box_editions::run_link_box_editions`).
- `web/prisma/schema.prisma` cited a `docs/multidisk.md` that no longer exists — fixed, points at `docs/sync_decisions.md` §9.

## 9. Round-1 action points
All matcher/equivalence/observability/data-repair fixes below shipped in round 2 except: `recordingId` backfill (open, highest structural yield of anything on the list), retaining the tidy run log (open — no persistent log kept, a post-mortem needs the DB alone).

## 10. Round 2 — what shipped (all 9 fixes landed together, `cargo test`: 382 passed)

**Matcher** (`boxset::pair_tracks_at`, replaces `pair_tracks`) — a strictness-graded ladder: exact title 5s → 15s (greedy) → 15s with 3+ already paired at 60s (needs unique candidate) → containment 5s/15s (needs unique) → qualifier-stripped title 5s/15s (needs unique) → typo-tolerant 5s/15s (needs unique, both durations known). Two ordering rules were load-bearing (found by replay, not reasoning): **tight window before wide** within a rule (else a newly-ambiguous pairing gets refused instead of matched), and **strictest depth first across discs** (else a folder that uniquely matches one disc under tight rules can get stolen by a looser rule matching a second disc too — broke Rome's "Hall Of Thatch", two masterings in one box).

**Partial bind**: a folder matching no disc is left out (not a group refusal) provided ≥2 folders resolve and none is ambiguous.

**Discovery**: new tier retries the release group's other editions after the held candidate fails; an all-already-placed group is rebuilt from stored rows, no MB call.

**Equivalences** (`box_editions.rs`): ambiguous candidates sharing one release group now tie-break deterministically (lowest release id) instead of refusing — both tier 2 and tier 3.

**Observability**: MB lookup failures logged + counted; summary breaks not-bound groups down by reason; artists hitting a lookup failure excluded from the `lastTidiedAt` stamp.

**Re-score**: `get_rescore_targets` gained a 3rd source — any release with links pointing outside its own release (fixes §5's 1,336 stale links).

**Regression gate**: both matchers replayed over all 818 real sibling groups, old vs new: groups binding 106→347, **0 regressions, 0 folders moved to a different disc**. (First replay, before the two ordering rules, found 2 regressions — both traced and fixed, which is the only reason the final number is 0.) Permanent harness: `boxset::tests::replay_library_dump` (`#[ignore]`d).

## 11. Open (round 2): "Dear Michael: The Motown Collection" — 3 unrelated albums bound to one box
3 genuinely different Michael Jackson albums all bound to the same 12-medium release, none placed — box pass can't reach it because the 3 folders sit at path depth 3 with no shared box-folder parent (this is the nested-groups gap, fixed in round 4 §15). A medium-level bind wouldn't work here either — this box pairs 2 albums per disc (24-track medium = 2 separately-owned albums), so no 1:1 pairing exists. **Root fault is upstream in the album matcher**: none of the 3 folders carries an embedded `MUSICBRAINZ_ALBUMID`, so a 9-track folder got bound to a 257-track/12-disc box by search or edition selection — should not be possible under the matcher's own rules. Not fixed this round; flagged for separate investigation.

## 12. Round 2, second pass — two faults caught by running it (run stopped at 325/1676 groups, restarted)

**12.1 Orphan sweep deletes dissolved boxes.** `delete_orphaned_mb_releases` never checked `LocalRelease.boxReleaseId` — only `releaseId`/`mbTrackId`. After `apply_dissolve`, a disc's `releaseId` names the standalone album, only `boxReleaseId` still names the box, so the box survived by accident (via track links). Deleting it silently nulls `boxReleaseId` on every disc (Prisma default `SetNull`, no `updatedAt` touch) — losing box provenance and, since §11's ownership check reads dissolved discs, bringing the standalone album back as a false MISSING gap. Measured: 208 discs already affected, 33 more boxes one run from the same fate. **Would have gotten dramatically worse** once round 2's re-link change removed the incidental track-link protection. Fixed: added `NOT EXISTS (boxReleaseId)` guard to the sweep, both scoped and global branches, before continuing the run.

**12.2 Partial bind needed a majority floor, not just a minimum.** "≥2 folders matched" let groups bind on under half their folders (Pink Floyd 2/16, Elvis 60CD 10/60) — worse than not binding, since the few matched folders fold into one entry and the rest stay loose. Added `matched * 2 >= siblings`. Cost: 21 of 347 binds; re-replayed, still 0 regressions.

**12.3 Why stopping mid-run was cheap.** `run_repair` plans every group fully before writing anything, so an interrupt writes nothing — verified 0 folds/dissolves/stamps from the partial run. Watermark only stamps on clean finish. `boxset::tests::replay_library_dump` (the permanent harness) agreed with the offline Python model exactly, which is what makes the "0 regressions" claim about shipped code, not a model of it.

## 13. Round 2 results (finished, 5h05m, 1233 artists)

```
Box groups: 1676 seen, 475 bound (184 folded, 285 dissolved, 6 key-taken, 1 failed, 154 from DB)
  not bound: 1201 - 629 no candidate, 5 fetch error, 489 no match, 55 ambiguous, 22 collision
Re-scored: 1194 complete, 85 extra tracks, 231 missing tracks (420 for stale track links)
```

vs round 1: dissolved box discs 771→**1,214** (295 boxes), fold members 3,604→**4,260**, total placed releases 1,120→**1,786** (+59%), true unplaced boxes 263/920→**157/410**, stale `mbTrackId` links 1,336→**0**, library `MISSING_TRACKS` 14,885→**14,182**, `COMPLETE` 115,367→**115,620**.

`629 no candidate` (no multi-medium MB release exists at all) is now the single largest not-bound bucket — bigger than every matcher refusal combined, and invisible before this round's breakdown. The matcher was never the whole problem.

**Residual, found here:**
- 37 discs (down from 208) still carry `boxMediumPosition` with no `boxReleaseId` — groups whose box the (now-fixed) orphan sweep had already deleted before the fix landed; self-heal once the group (re-)binds.
- 98 box releases now protected only by the `boxReleaseId` guard (up from 33) — all would've been deleted by the pre-fix sweep.
- **44 folded boxes score `MISSING_TRACKS` while holding every track** (of 1,518 folded, 1,363 `COMPLETE`, 155 `MISSING_TRACKS`, 44 of those hold every track). Cause: round 2 taught the box matcher new qualifier-stripping/typo title rules; `status::titles_match` (the status *scorer*) never learned them — same Marillion "(alternative version)" vs "(re-record)" pairing binds the box but scores it incomplete. **Not fixed here deliberately** — `titles_match` scores every release in the library (151,928 total), not just folded boxes; loosening it for 0.03% of releases risked moving status on far more than it fixed. Needed the same replay-before-deploy treatment as the box matcher. → Fixed in round 3 (§14).
- `groups_failed > 0` blocks the watermark stamp for the *entire* scope (conservative, not harmful — placements still land, just the stamp is withheld).

## 14. Round 3 — the status scorer (fixes §13's 44-release gap)

Cause: round 2 taught `boxset::pair_tracks_at` new title rules; `status::check_release_status` never learned them. Fix: the round-2 title rules moved into a shared `title_rules` module used by both matcher and scorer (see `title_rules.rs` header — **this is the code comment's §13/round-2 citation**, referring back to this drift). Added scorer passes: qualifier-stripped equality, and 1-2 letter typo tolerance — both refuse if contested from either side or if the titles name different numbers; differing-qualifier pairs need both runtimes known and within 2s; among identical titles the exact pass now takes the closest runtime, not the first file. Also: `LocalTrackRow`/`track_metas_from_rows` had been hardcoding `duration: None`, so local durations never reached the scorer — fixed. New flag: `tidy --rescore-only` (DB-only re-score including `MISSING_TRACKS`, no stamp) — how a scorer-only fix reaches already-scored releases.

Every guard (numbers-must-not-disagree, differing-qualifier duration window, roman-numeral whitelist) was found by replaying both scorers over 23,490 releases and reading actual mismatched pairings, not by reasoning.

**Results**: 1,034 `MISSING_TRACKS`→`COMPLETE` (0 wrong-direction moves), 25,452 track links gained, 36 of the 44 mis-scored folded boxes fixed. Library `COMPLETE` 115,620→116,654, `MISSING_TRACKS` 14,182→13,148. Estimated wrong-pairing rate 1-2%, bounded above by ~5% (one known-wrong pairing shipped: Yello live vs. instrumental-mix bonus track, 242s/241s).

**Open, found during round 3:**
- **3,603 multi-disc releases stored as `mediumCount=1` with no medium rows** → 1,745 local releases `MISSING_TRACKS` purely from being scored against the full multi-disc tracklist instead of their own disc. (This diagnosis was corrected in round 4, §15 — not a write-path bug, a one-time historical gap.)
- Legacy loose title-matching pass pairs by bare substring with no duration guard (~102 library-wide bad links, e.g. tag "You" matching "What's the Matter With You Baby") — needs its own replay before fixing, since it would flip some `COMPLETE`→`MISSING_TRACKS`.

## 15. Round 4 — discs split across a folder and its subfolder

Two stacked faults, both root-caused here (corrects round 3's diagnosis: not `db::upsert_mb_release` hardcoding 1 disc — its only callers make trackless `MISSING` placeholders):

1. **Pre-multidisk releases never got their discs.** Media were first modelled 2026-09-06/07; every release synced before that and not re-synced since kept `mediumCount=1`/no medium rows despite tracks carrying real disc numbers. 3,602 releases (3,599 from that one week). Since every multi-disc decision keys off `mediumCount>1`, these were invisible to the box pass.
2. **Box pass never saw folder+subfolder layout.** Disc 1 in the album folder itself, disc 2 in a subfolder beneath it — `find_sibling_groups` only groups folders sharing a *common parent*, so the root's own parent (the artist type folder) never grouped them together.

**Fix**: `db::backfill_media_from_track_discs` — new tidy phase before the box pass, pure SQL, rebuilds medium rows + `mediumCount` from stored disc numbers (only where every track has a disc number and ≥2 distinct values). `boxset::nested_groups` — a root folder + every folder beneath it bound to one multi-disc release is now a discovery source feeding the *same* unchanged bind/equivalence/fold-or-dissolve pipeline; never overlaps a sibling group.

**Verified**: simulated over all 276 nested groups, 185 bind (every one covering all its folders). Stage 1 (6 artists incl. must-not-change cases): 0 wrong-direction changes. Stage 2 (209 artists owning a nested group, 43 min): 179 `MISSING_TRACKS`→`COMPLETE`, 0 other status changes, 0 releases lost track links, 177 duplicate cards absorbed, multi-disc-stored-as-one-disc 3,602→**0**. Library `MISSING_TRACKS` 13,146→12,790, `COMPLETE` 116,647→116,826.

**Open**: 21 nested groups where the root folder holds 2 discs at once (needs `plan_box_bind` to let one folder cover several discs — separate change, left for its own replay). 2,404 `COMPLETE` releases with 0 linked tracks — pre-existing, not caused by rounds 3/4, likely a re-index artifact, not verified.

## 16. Round 5 — compilations bound to the wrong album by scattered tags

Cause: a per-track tagger scattered many budget compilations across dozens of album ids (one 35-track compilation → 31 distinct album ids). Sync's Tier 1 bound on any plurality of 2+ matching tracks (`majority_from_counts`), so e.g. 20 unrelated Harold Land compilations all collapsed onto one unrelated 8-track album. Two layers, only binding fixed here (ownership pollution via the same scattered per-track artist tags — layer 2 — is index's problem, not touched).

**Fix**: Tier 1 binds by tag only when the id (or its release group) is carried by **more than half** the tagged tracks. A scattered folder's winning id is still fetched free but bound only if its tracklist scores `COMPLETE`. Tier 2 browses only a release group most tracks agree on. A rejected scatter is not re-searched by title (its title *is* the scattered tag) — ends `UNMATCHED`. `mark_local_release_unmatched` now also clears track links (used to leave them, keeping the old release alive in the orphan sweep).

**Repair of existing bindings** (sync never re-examines an already-bound release, so damage was repaired directly from the DB — decidable because stored status *is* the scorer's verdict against the wrongly-bound release): 2,812 releases with no majority for any other release group → `UNMATCHED`, 24,976 stale links cleared, one transaction. 7 releases had a real majority for another release group → re-synced (2 `COMPLETE`, 4 `UNMATCHED`, 1 bound to agreed-but-wrong tags). Undo records on NAS: `logs/undo16_releases.tsv`, `logs/undo16_links.tsv`. Library: `MISSING_TRACKS` 12,790→11,151, `EXTRA_TRACKS` 4,590→3,408, `UNMATCHED` 17,007→19,826.

**Open, deliberately left**: 124 Chronological Classics bindings where the files genuinely *agree* on the wrong CC volume (tagger was internally consistent) — nothing in the metadata distinguishes this from a real partial album, folder names aren't allowed as evidence. Needs retagging the files. List: `docs/specs/spec_tidy_observations_cc_retag.tsv`, background: `docs/sync_decisions.md` §19 item 9.

## 17. Round 6 — artists sync never saw, and one-off scripts that never ran

**5,445 owning artists with no `lastIndexedAt`**: index's post-scan resolution (`index::resolve::resolve_and_apply`) replaces a provisional compound owner ("Jimmy Regal And The Royals") with the real artists it names, often creating them — but never stamped `lastIndexedAt` on the ones it substituted. Sync's pending query requires `lastIndexedAt IS NOT NULL`, so these artists were invisible to every sync ever run, including the "full" rollout. 437 releases owned only by them, 406 `UNMATCHED` because nothing had ever tried. **Fixed** (commit `55a9a230`): owner insert now `RETURNING`s the artists it actually linked and stamps `lastIndexedAt` in the same transaction. Backfilled 5,490 artists directly (undo: `logs/undo17_never_indexed.txt`); they then flow through the normal `./sync && ./tidy` backlog.

**`repair_recording_tags.py` had never actually run** (docs said it had) — died at parse time on the NAS's Python 3.11 (nested-quote f-string is 3.12-only). Fixed and run: FŒHN 8 files blanked and verified, Elvis Presley dry run 1,279 planned changes, library-wide run started (~14h, I/O bound ~2,200 files/min). Undo: `logs/recording_tags_*.csv`.

**`dedupe_artist_images.py` had also never run** (NAS host has no `psycopg2`) — run from a disposable container instead. 17 `Artist.image` rows nulled + files removed (aliases/members wearing the main act's photo: Yusuf Islam→Cat Stevens, Wagon Christ→Luke Vibert, etc.). Undo: `logs/undo18_artist_images.tsv` + `.tgz`.

**Cleanup**: both scripts + `oneoff/` deleted from repo and NAS. All rounds 1-6 scratch files removed from NAS `/tmp` and `logs/` except the undo records above, kept on purpose.
