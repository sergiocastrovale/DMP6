# Tidy rollout — post-run analysis (2026-09-18)

Critical review of the first full `./sync` + `./tidy` rollout (docs/__plan_tidy_script.md Step 10).
Every number below was queried read-only against prod (`ix-postgres-postgres-1`) on 2026-09-18, after
the final `./tidy` run finished.

Final run summary, for reference:

```
Tidy complete. (6h:38m:07s)
Empty releases removed: 0
Orphans / placeholders: 0 / 0 (round 1), 72 / 0 (round 2)
Box groups    : 2857 seen, 1420 bound (1192 folded, 223 dissolved, 5 key-taken, 0 failed)
Re-scored     : 1901 complete, 0 incomplete, 57 extra tracks, 96 missing tracks, 0 other, 0 deferred
Identities    : Pass A: 1, Pass B: 200, Pass C: 15
Completeness recomputed: 17434
Artists stamped: 17412
```

**Verdict: goal partly met.** Fold/dissolve is correct wherever it fires, and nothing it wrote is
wrong. But roughly half the box groups it saw were never bound, and the summary gives no way to tell
why. Four bugs found, one reproducible end to end.

---

## 1. What the rollout achieved

| Measure | Pre-rollout (docs/sync_decisions.md §9/§17) | Now |
|---|---|---|
| Dissolved box discs | 133 | **771** (across 218 boxes) |
| Fold members (`LocalReleaseMember`) | 395 | **3,604** (1,339 folded releases) |
| Discs bound to their own medium | — | **556** |
| Total placed `LocalRelease` rows | ~528 | **1,120** |
| §17 split-disc query | 1,300 groups / 3,411 rows | **459 / 2,212** |
| Box-placed discs stuck at `matchStatus='UNKNOWN'` | 588 | **0** |

Verified clean:

- **63 `UNKNOWN` rows remain, all with `releaseId IS NULL`.** Correctly excluded from phase 5 (which
  needs a bound release), correctly left for the next `./sync`'s own UNKNOWN clause. The verification
  checklist item "one `./sync && ./tidy` leaves no box-placed disc at UNKNOWN" **passes**.
- **0 `Box-set repair error`** in `logs/errors.log` for the run. §9's "one box never blocks the rest"
  error boundary held.
- **Lock heartbeat works.** `errors.log` shows `Cannot start: lock held by tidy (pid 846)` at
  `2026-09-17 23:00:53`, 6.5h into the run — `clear_stale_lock_minutes(10)` never stole it. Step 5 of
  the plan is confirmed in production.
- **Folds are structurally sound:** 1,339 folded releases, **0** with a NULL `discNumber` on any track.
- **Placement quality:** dissolved discs 636/771 `COMPLETE`; medium-bound discs 529/556 `COMPLETE`.

---

## 2. Candidate walkthroughs

### 2.1 HIM — "The Single Collection" — FIXED

The case that triggered the whole investigation (docs/sync_decisions.md §17).

**Before:** 10 sibling folders, each its own `LocalRelease`, all bound to the same 10-medium
`MusicBrainzRelease`, every one with `mediumPosition IS NULL`. The UI rendered 10 identical cards all
titled "The Single Collection".

**What tidy did:** bound the group via tier (b) (the release a sibling was already bound to) →
`count_equivalents` returned 0 (a singles box has no standalone album twins) → **fold**.

**Now:**

```
HIM/Album/2002 - The Single Collection [#74321 96173 2]   COMPLETE   mediumCount 10
  10 LocalReleaseMember rows, discNumber 1..10, in folder order
```

**Why correct:** §9's rule is fold when 0–1 discs are recognisable as standalone releases. Every disc
here is a CD single; §7's allow-list never invents standalone singles, so no equivalence can exist.
One entry is the right answer, and the disc numbers are preserved on the members.

### 2.2 ABBA — "The Complete Studio Recordings (9CD)" — PARTIAL

**Before:** all 9 discs bound whole-box at `MISSING_TRACKS`, unscored across three consecutive syncs
(the §10 matcher-vs-box-pass fight).

**Now:**

| Disc | `releaseId` points at | `mediumPosition` | `boxMediumPosition` | status |
|---|---|---|---|---|
| CD1 Ring Ring | the box | 1 | — | MISSING_TRACKS |
| CD2 Waterloo | **Waterloo** (standalone) | — | 2 | EXTRA_TRACKS |
| CD3 ABBA | **ABBA** (standalone) | — | 3 | COMPLETE |
| CD4 Arrival | the box | 4 | — | COMPLETE |
| CD5 The Album | **The Album** | — | 5 | EXTRA_TRACKS |
| CD6 Voulez-Vous | **Voulez‐vous** | — | 6 | EXTRA_TRACKS |
| CD7 Super Trouper | **Super Trouper** | — | 7 | EXTRA_TRACKS |
| CD8 The Visitors | **The Visitors** | — | 8 | EXTRA_TRACKS |
| CD9 Rarities | the box | 9 | — | COMPLETE |

**Correct parts.** Six discs dissolved onto the albums they reprint, with box provenance kept in
`boxReleaseId`/`boxMediumPosition`. CD9 Rarities correctly stayed attached to the box — §9's "discs
with no standalone equivalent stay attached". `EXTRA_TRACKS` on the dissolved discs is honest, not a
fault: a box disc carries bonus tracks the standalone edition does not list. Ownership propagated
correctly (§11) — Waterloo, The Album, Voulez-Vous, Super Trouper and The Visitors are **no longer
listed as MISSING gaps** for ABBA.

**Wrong parts.** CD1 Ring Ring and CD4 Arrival have obvious standalone twins sitting in the DB and
tier-1 eligible (4 `Arrival` rows at 10/10/11/16 tracks, 3 `Ring Ring` rows at 12/12/25), yet got no
equivalence at all. Cause is `resolve_containment_winner` (`scripts/sync/src/box_editions.rs:346-357`):
several candidates fit, the only tie-break is `is_original_work`, so the outcome is `Ambiguous` and the
medium is left unset. **All four `Arrival` candidates share one `releaseGroupId`
(`e464e167-83ab-3b59-88bd-262cf552056e`)** — refusing a tie in which every candidate is the same release
group buys nothing, since §11's ownership check is release-group scoped anyway.

---

## 3. Bug 1 — one bad track kills an entire box (dominant failure mode)

`pair_tracks` (`scripts/sync/src/boxset.rs:105`) requires `local.len() == medium.len()` and every local
track to resolve to a distinct medium track. `plan_box_bind` (`boxset.rs:218`) returns `None` the moment
one sibling matches zero or more than one medium. `run_repair` (`boxset.rs:1059`) then skips the
**entire group**.

### 3.1 Proof — Marillion, "The Singles '82-88' (Boxset)"

12 folders, 12 media, track counts line up exactly: `3,3,5,4,4,5,3,3,4,4,3,4`. The release was fetched
live from MusicBrainz (`4a0a6fe3-6130-453e-9dcb-555481bcafaa`) — all 12 media present, all tracks
returned, so this is **not** the `inc=recordings` truncation problem from §13. Replaying
`plan_box_bind`'s exact three-pass logic:

```
ok     CD 1 - Market Square Heroes (1982)   -> medium 1
ok     CD 2 - He Knows You Know (1983)      -> medium 2
ok     CD 3 - Garden Party (1983)           -> medium 3
REFUSE CD 4 - Punch & Judy (1984)           -> 0 media match
ok     CD 5 - Assassing (1984)              -> medium 5
ok     CD 6 - Kayleigh (1985)               -> medium 6
ok     CD 7 - Lavender (1985)               -> medium 7
ok     CD 8 - Heart of Lothian (1985)       -> medium 8
ok     CD 9 - Incommunicado (1987)          -> medium 9
ok     CD 10 - Sugar Mice (1987)            -> medium 10
ok     CD 11 - Warm Wet Circles (1987)      -> medium 11
ok     CD 12 - Freaks - live (1988)         -> medium 12

RESULT: REFUSED
```

The single offending track, on CD 4:

```
LOCAL: Market Square Heroes (alternative version)   [288s]
MB   : Market Square Heroes (re-record)             [288s]
```

Durations agree to the second. Normalised (`owned::normalize_title`, alphanumerics only) they are
`marketsquareheroesalternativeversion` vs `marketsquareheroesrerecord`: not equal, and neither contains
the other, so pass 1, pass 1b and pass 2 all fail. One bonus track's wording costs a 12-disc box its
entire placement.

This is the same shape as the ABBA failure §9 says was paid for in real damage — but the fixes there
covered *duration drift* (pass 1b, 15s) and *title suffixes* (pass 2, containment). A genuine title
**disagreement** was never covered.

### 3.2 How widespread

`plan_box_bind` was replayed against stored MB tracklists for all **263 genuine unplaced boxes** — every
sibling bound to one and the same multi-medium release, none placed (920 `LocalRelease` rows):

| Refusal reason | Groups |
|---|---|
| A sibling matches no medium | **220** |
| …of which **exactly one bad folder**, every other sibling perfect | **126** |
| A sibling matches more than one medium | 36 |
| Two siblings claim the same medium | 3 |
| Would bind cleanly on current data (see Bug 2) | 4 |

Root cause of the 126 single-bad-folder groups:

| Cause | Groups | What would fix it |
|---|---|---|
| Identical titles, duration-only kill | 37 | 7 of 37 are within 15s, 21 within 30s — pass 1b's `SAME_TRACK_DIFFERENT_MASTER_SECS = 15` is too tight |
| Genuinely different title | 29 | a fuzzy tier — real pairs: `sweetemalinamygal`/`sweetemalinemygal`, `frearmsmash`/`forearmsmash`, `blessyourselfandthechildren`/`blessthebeastsandthechildren` |
| Containment **would** match, duration blocked it | **13** | **pass 2 uses `durations_compatible` (5s) while pass 1b already allows 15s** — real pairs: `20hzsinewave`⊃`20hz`, `partix`⊂`londonpartix`, `afterthedancevocal`⊃`afterthedance` |
| Track count differs from every free medium | 39 | partial bind, docs/sync_decisions.md §19 item 1(b) |
| No free medium left | 9 | — |

Cheapest high-yield fix is the 13: give pass 2 the same 15s window pass 1b already has.

---

## 4. Bug 2 — a MusicBrainz lookup failure is silent, then permanent

`candidates_from_embedded_ids` (`boxset.rs:328`) and `candidates_from_search` swallow every error:

```rust
Err(e) => reporter.sub_step(&format!("  -> lookup failed: {e}")),
```

No `common::error_log::log_warn`, no retry, no `groups_failed` increment. In the summary a transient
503 is indistinguishable from "this group has no box release".

**Evidence.** Four groups bind cleanly when replayed against *live* MusicBrainz data, yet sit unplaced:
Pixies "Doolittle 25", Thunder "Rip It Up (Deluxe Edition) (3 CD)", Hawkwind "Levitation", IQ "The
Wake". Both siblings in each are already bound to the multi-medium release, so `bound_box_mb_ids`
(tier (b)) had the id available. Live fetch is complete:

```
Doolittle 25 (7490a74b-…)  pos1 CD 15 tracks, pos2 CD 13, pos3 CD 22
  CD2 (Peel Sessions)  tracks=13  hits=[2]
  CD3 (Demos)          tracks=22  hits=[3]     -> binds
Rip It Up (f16ea191-…)     pos1 CD 11 tracks, pos2 CD 8, pos3 CD 6
  CD 2 (Live at the 100 Club Pt. 1)  tracks=8  hits=[2]
  CD 3 (Live at the 100 Club Pt. 2)  tracks=6  hits=[3]  -> binds
```

All four artists carry `lastTidiedAt = 2026-09-17 16:31:46.582` — they were in scope and were stamped
anyway. **Phase 10 stamps the watermark regardless of groups that were skipped**, so a plain `./tidy`
will never revisit them. Only `--all`, an explicit `--only`, or a re-sync of the artist will.

---

## 5. Bug 3 — 1,336 stale `mbTrackId` links

Local tracks pointing at a `MusicBrainzReleaseTrack` belonging to a **different** release than their
own `LocalRelease.releaseId`:

```sql
SELECT count(*) AS stale_links, count(DISTINCT t."localReleaseId") AS releases
FROM "LocalReleaseTrack" t JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId";
-- 1336 links across 122 releases; 105 of those releases are dissolved box discs
```

ABBA is the clean demonstration (`ok_links` = links agreeing with the disc's own `releaseId`):

| Disc | `releaseId` | tracks | linked | ok_links |
|---|---|---|---|---|
| CD2 Waterloo | Waterloo | 18 | 18 | **0** |
| CD3 ABBA | ABBA | 14 | 14 | **0** |
| CD5–CD8 | standalone albums | 11–16 | all | **0** |
| CD1 / CD4 / CD9 | the box | 19 / 15 / 11 | all | all |

`LocalRelease.updatedAt` on all nine discs is `2026-09-09` — the Sep-13 tidy never rewrote the rows.

`rescore_bound_release` (`scripts/sync/src/db.rs:588`) does the right thing: it re-links matched tracks
and NULLs everything the score did not re-confirm. The gap is in **which rows reach it**.
`get_rescore_targets` picks only `matchStatus='UNKNOWN' AND releaseId IS NOT NULL` for scoped artists,
unioned with this run's `touched_local_release_ids`. A disc dissolved by the **pre-tidy, sync-era box
pass** and already scored back then is in neither set, so its links are never reconciled. `apply_dissolve`
only sets `UNKNOWN` "when something changed", and for these discs nothing did.

Not caused by tidy — inherited from the Sep 9/10 sync-era rollout — but tidy is the pass that is
supposed to clean it up and currently cannot see it.

---

## 6. Bug 4 — the summary hides the failure mode

```
Box groups : 2857 seen, 1420 bound (1192 folded, 223 dissolved, 5 key-taken, 0 failed)
```

1,437 groups were seen and not bound, and get **no line at all**. `groups_seen` also counts groups
dropped at `run_repair:983` for `rows.len() < 2`, which can never bind, so the denominator is inflated
too. Every skip path is `reporter.skip` only — `no artist link found for this group`, `no multi-medium
candidate found`, `N candidate(s) checked, none matched` — nothing counted, nothing written to
`errors.log`. With no run log retained, a post-mortem is impossible without re-running.

`docs/sync_decisions.md` §10 already tells the reader to check this line for "groups that were seen but
not bound" — the line does not currently carry that information.

---

## 7. Equivalence coverage — an undocumented ceiling

```
box-disc media (on mediumCount > 1 releases):  22,680
  with an equivalence set:                      3,337   (14.7%)
  of which via tier 1 (exact recording set):    2,758
single-medium releases:                       113,702
  usable as a tier-1 target:                   65,399   (57.5%)
```

**42.5% of single-medium releases cannot serve as a tier-1 equivalence target**, because at least one of
their tracks has no `recordingId` and `link_by_recording_fingerprint`
(`scripts/sync/src/box_editions.rs:104`) requires `count(*) FILTER (WHERE t."recordingId" IS NULL) = 0`.
Every box disc whose standalone twin falls in that 42.5% has to fall through to tier 2 (title+duration)
or tier 3 (containment), both of which refuse far more often.

This is the structural reason the run folded 1,192 groups and only dissolved 223. It is not listed in
§15's known limits, and a `recordingId` backfill would move dissolve rates more than any matcher tweak.

---

## 8. Other observations

- **§17's own metric over-counts.** Its final `count(*) FROM lr JOIN bad USING (parent)` counts *every*
  `LocalRelease` in a flagged parent, including correctly-placed ones. The honest figure is **1,613
  genuinely-unplaced multi-medium rows** across 459 groups. Of those 459: 339 all-same-MB (true box
  failures), 43 mixed, 77 all-distinct-MB (wrong-edition binds — §19 item 1(a), not box discs at all).
- **§19 item 3 is still open and now measurable:** **230 groups / 1,113 rows** are fully placed yet still
  re-discovered and re-fetched from MusicBrainz on every unscoped run.
- **34 groups** have a box root folder that is already its own `LocalRelease` (`groupKey = 'folder:<parent>'`),
  but only 5 were counted `key-taken` — the other 29 were refused before ever reaching the fold stage.
  §17 predicted 10.
- **215 artists have `lastTidiedAt` set but `lastSyncedAt` NULL.** Not a bug: identity-repair passes B and C
  (`db.rs:1427`, `db.rs:1518`) NULL `lastSyncedAt` to push the entry back into sync's pending queue (§6),
  and phase 10 then stamps `lastTidiedAt` on the whole scope. Worth a sentence in `docs/scripts/tidy.md`,
  since it makes the watermark invariant look violated when it is not.
- **The rollout is not finished.** 5,674 artists that own local releases are pending sync, and 2,164
  artists with releases have `musicbrainzId IS NULL`. Per §16 step 3, another `./sync` then `./tidy` is
  required before any of these numbers settle.
- `web/prisma/schema.prisma:262` cites `docs/multidisk.md §2/§5` — **that file does not exist**.

---

## 9. Action points

Ordered by yield per unit of work. Each is independently shippable.

### Matcher fixes (`scripts/sync/src/boxset.rs`)

- [x] **Pass 2 duration tolerance.** `pair_tracks` pass 2 (containment) uses `durations_compatible`
      (5s) while pass 1b already allows `SAME_TRACK_DIFFERENT_MASTER_SECS` (15s). Use the same 15s
      window in pass 2. Unblocks **13 boxes**. Unit test from the Bass Mekanik pair
      (`20hzsinewave` / `20hz`) and the Keith Jarrett pair (`partix` / `londonpartix`).
- [x] **Fuzzy title tier (pass 3).** Add a final pass for leftovers: normalised edit distance or token
      overlap, still requiring a unique candidate and a compatible duration. Unblocks up to **29 boxes**.
      Test fixtures: `sweetemalinamygal`/`sweetemalinemygal` (Art Tatum),
      `frearmsmash`/`forearmsmash` (Budgie), `blessyourselfandthechildren`/`blessthebeastsandthechildren`
      (Belinda Carlisle). Must still refuse `summernightcity` vs `waterloo` (ABBA) and
      `distortion` vs `失真` (G.E.M.).
- [x] **Widen pass 1b for identical titles.** 21 of the 37 duration-only kills are within 30s. Consider
      raising `SAME_TRACK_DIFFERENT_MASTER_SECS` only when the normalised titles are *identical* and the
      pairing is otherwise unique. Do not widen the containment pass this far.
- [x] **Partial bind** (docs/sync_decisions.md §19 item 1(b)): at least 2 siblings match a distinct
      medium each, and every unmatched sibling matches *zero* media of the chosen candidate. Addresses
      the **39** track-count-mismatch groups. Never accept "matches but ambiguously".
- [x] **Try other editions of the bound release group** (§19 item 1(a)) when the currently-bound
      candidate fails `plan_box_bind`. Addresses the 77 all-distinct-MB groups.

### Equivalence fixes (`scripts/sync/src/box_editions.rs`)

- [x] **Release-group tie-break in `resolve_containment_winner`.** When every ambiguous hit shares one
      `releaseGroupId`, pick deterministically (lowest `musicbrainzId`) instead of returning
      `Ambiguous`. Unblocks ABBA "Arrival" and "Ring Ring" and their whole class.
- [x] **Same tie-break for tier 2.** The `let [hit] = hits[..] else { … }` arm at `box_editions.rs:411`
      has no release-group tie-break at all — only an `ambiguous` counter.
- [ ] **`recordingId` backfill.** 42.5% of single-medium releases are unusable as tier-1 targets. Add a
      pass (or a `sync` fixup) that re-fetches `recordingId` for releases missing it, then re-run
      `link_by_recording_fingerprint`. Highest structural yield of anything on this list.
- [x] Document the tier-1 target ceiling in `docs/sync_decisions.md` §15.

### Robustness / observability (`scripts/sync/src/boxset.rs`, `scripts/tidy/src/main.rs`)

- [x] **Log and count MusicBrainz lookup failures.** `candidates_from_embedded_ids` and
      `candidates_from_search` must call `common::error_log::log_warn` and increment a new
      `candidate_fetch_failed` counter instead of only `reporter.sub_step`.
- [x] **Do not stamp the watermark for artists whose groups hit a fetch error.** Either exclude those
      artists from the phase-10 stamp, or set `had_error` for the run. Today a transient 503 is
      permanent until `--all` or a re-sync.
- [x] **Break down `groups_seen`.** Add counters: `no_candidate`, `candidate_fetch_failed`,
      `plan_refused_no_match`, `plan_refused_ambiguous`, `plan_refused_collision`, and exclude
      `rows.len() < 2` groups from `groups_seen` (or report them separately). Update the summary line
      and `docs/sync_decisions.md` §10's troubleshooting row.
- [ ] **Retain the tidy run log.** The final run's output was not kept, which is why section 3 required a
      30-minute offline simulation. Write to `logs/tidy-run.log` alongside `errors.log`, or document the
      `tmux … > /tmp/tidy-run.log` pattern from §20 as mandatory.

### Data repair

- [x] **Extend phase-5 re-score targets** to any `LocalRelease` holding a `LocalReleaseTrack` whose
      `mbTrackId` belongs to a different release than `LocalRelease.releaseId`. Fixes the **1,336 stale
      links across 122 releases**. Query in section 5 is the target selector.
- [x] **Skip already-placed groups in `find_sibling_groups`** (§19 item 3) — **230 groups / 1,113 rows**
      currently cost a cold MusicBrainz lookup on every unscoped run for no new information. Keep running
      `box_editions::run_link_box_editions` over them so a new equivalence can still re-home a disc.
- [ ] **Follow-up `./sync` then `./tidy`.** 5,674 artists owning local releases are pending sync (partly
      the 215 the identity repair pushed back into the queue, §16 step 3).

### Docs

- [x] Fix the `docs/multidisk.md` reference at `web/prisma/schema.prisma:262` — write the file or point
      the comment at `docs/sync_decisions.md` §9.
- [x] Replace §17's split-disc query with one that counts only genuinely-unplaced multi-medium rows
      (it currently counts every row in a flagged parent, inflating both the baseline and the result).
- [x] Note in `docs/scripts/tidy.md` that identity repair NULLs `lastSyncedAt`, so `lastTidiedAt` set
      with `lastSyncedAt` NULL is expected, not a watermark violation.

---

## 10. Round 2 — what shipped (2026-09-18)

All nine fixes above landed in one change. `cargo test`: 382 passed, 0 failed.

**Matcher** (`scripts/sync/src/boxset.rs`) — `pair_tracks` became `pair_tracks_at`, a ladder of rules
gated by a strictness `depth`:

| Rule | Window | Unique required | From depth |
|---|---|---|---|
| normalized title equal | 5s | no (greedy) | 0 |
| normalized title equal | 15s | no (greedy) | 0 |
| normalized title equal, 3+ already paired | 60s | yes | 1 |
| one title contains the other | 5s, then 15s | yes | 0 / 1 |
| titles equal minus a trailing qualifier | 5s, then 15s | yes | 2 |
| near-identical titles (typo), both durations known | 5s, then 15s | yes | 3 |

Two ordering rules turned out to be load-bearing, and both were found by the replay below rather than
by reasoning:

- **Tight window before wide, within a rule.** Widening a rule can turn its single candidate into two,
  and the uniqueness test then refuses. Claiming at 5s first means every pairing the old rule found is
  still found.
- **Strictest depth first, across discs.** A folder that matches exactly one disc under the tight rules
  keeps that disc even when a looser rule would also match a second. Without this, Rome's "Hall Of
  Thatch" (two masterings of one album in the same box) stopped binding.

**Partial bind** — a folder matching *no* disc is left out instead of refusing the group, provided ≥2
folders still resolve and none is *ambiguous*.

**Discovery** — a new tier tries the release group's other editions after every held candidate fails,
and a group whose folders are all already placed is rebuilt from stored rows with no MusicBrainz call.

**Equivalences** (`box_editions.rs`) — when every ambiguous candidate belongs to the same release
group, the tie is broken deterministically (lowest release id) instead of refused. Applies to both
tier 2 and tier 3.

**Observability** — MusicBrainz lookup failures are logged to `errors.log` and counted; the run summary
breaks the not-bound groups down by reason; artists whose group hit a lookup failure are **excluded
from the `lastTidiedAt` stamp** so the next run retries them.

**Re-score** — `get_rescore_targets` gained a third source: any release whose track links point outside
its own release. That is what reaches the 1,336 stale links in §5.

### Regression gate

Unit tests alone cannot answer "did anything that used to bind stop binding", so both matchers were
replayed over **every** sibling-folder group in the library (818 groups with usable data), old logic
against new:

| | Old | New |
|---|---|---|
| Groups binding | 106 | **347** |
| Groups that bound before and refuse now | — | **0** |
| Folders moved to a different disc | — | **0** |

The first replay (before the two ordering rules above) showed 2 regressions. Both were traced,
understood and fixed rather than accepted — that is the only reason the final number is 0.

---

## 11. Open: three unrelated albums bound to one box ("Dear Michael: The Motown Collection")

Raised in `docs/future.md` as "3 exactly equal releases grouped. Clearly a bug." Confirmed, and it is
**not** the box-set failure this round fixes.

Three genuinely different Michael Jackson albums are all bound to the same 12-medium
`MusicBrainzRelease`, none placed on a medium, so the UI renders three identical cards:

| Folder | Local tracks | Bound to |
|---|---|---|
| `2009 - 20th Century Masters… Best of Michael Jackson` | 11 | Dear Michael: The Motown Collection (12 media) |
| `2013 - Farewell My Summer Love` | 9 | same |
| `2013 - Looking Back To Yesterday` | 12 | same |

Why the box pass cannot reach it: the three folders sit directly under `Michael Jackson/Album/`, so
they are at path depth 3 and share no parent *box* folder. `find_sibling_groups` only considers folders
at depth ≥ 4 grouped by their common parent — this is §19 item 2 ("shared multi-medium releases across
**different** parent folders"), which is still open.

Why the obvious fix would not work either. §19 item 2 proposes a medium-level bind without folding —
pair each folder against exactly one medium and set `mediumPosition`. That fails here, because this
box pairs **two albums per disc**:

```
medium  3  Hello World: The Motown Solo Collection (disc 3)
           - Looking Back to Yesterday / Farewell My Summer Love     24 tracks
```

The user owns those two albums separately (12 and 9 tracks). Neither can pair 1:1 with a 24-track
medium, so no medium-level bind exists — §15 known limit 2, from the other direction.

**The real fault is upstream, in the album matcher.** Verified: none of the three folders carries an
embedded `MUSICBRAINZ_ALBUMID` (`LocalReleaseTrack.mbReleaseId` is NULL on all 32 tracks), so §7 step 1
is not the path taken — a 9-track folder was bound to a 257-track, 12-disc box by search or by edition
selection, which §7's own rules should not permit. That is where the next investigation should start,
not in `boxset.rs`.

Not fixed in this round, and deliberately so: it is a different code path, the diagnosis above was only
reached after the round-2 work was already committed, and changing the album matcher on the strength of
one example is how the faults in §3 got introduced in the first place.

---

## 12. Round 2, second pass — two faults caught by running it (2026-09-18)

The round-2 run was started, then **stopped after 325 of 1676 groups** and restarted. Both reasons are
worth recording, because neither was visible in unit tests or in the offline replay.

### 12.1 The orphan sweep deletes dissolved boxes

`db::delete_orphaned_mb_releases` kept a `MusicBrainzRelease` alive if a `LocalRelease.releaseId` or a
`LocalReleaseTrack.mbTrackId` pointed at it. It never checked `LocalRelease.boxReleaseId`.

A dissolved box is exactly the shape where the first check cannot fire: after `apply_dissolve` each
disc's `releaseId` names the *standalone album it reprints*, and only `boxReleaseId` still names the
box. The box survived purely by accident, through the `mbTrackId` links `persist_box_media` leaves
pointing at the box's own track rows.

`boxReleaseId` carries no `onDelete` override, so Prisma's default for an optional relation is
`SetNull`. Deleting the box therefore **nulls `boxReleaseId` on every one of its discs, silently, without
touching `updatedAt`** — leaving `boxMediumPosition` as the only trace that a dissolve ever happened.

Measured immediately after the interrupted run:

```
discs with boxMediumPosition set but boxReleaseId NULL : 208
box releases currently protected only by boxReleaseId  :  33   (one run from the same fate)
```

Bad Company's six-disc SWAN SONG, Chic's "Original Album Series", and others — all still correctly bound
to their standalone albums, all with their box provenance gone. It is not cosmetic: §11 counts a
dissolved box disc as owning its album, so a deleted box brings that album back as a missing-album gap.

**Round 2 would have made this dramatically worse.** Fix 7 re-links a dissolved disc's tracks to the
standalone release — removing the incidental `mbTrackId` protection that was the only thing keeping
these boxes alive. The fix (a third `NOT EXISTS` on `boxReleaseId`, both scoped and global branches)
had to land before the run could safely continue.

This was found only because the interrupted run's placement counts were compared against the
pre-run numbers and 202 discs had quietly changed category with `updatedAt` untouched.

### 12.2 Partial bind needed a floor, not just a minimum

The partial bind shipped with "at least 2 folders matched". Replaying it over the library showed 21
groups binding on **under half** their folders — Pink Floyd's "Oh By The Way" at 2 of 16, Elvis's 60CD
box at 10 of 60, Johnny Cash's 18CD at 3 of 18.

For a group that then *folds*, that is worse than doing nothing: the few matched folders merge into one
entry and the rest stay loose. Added a majority floor (`matched * 2 >= siblings`). Cost: 21 of 347
binds. Re-replayed after the change — still **0 regressions, 0 folders moved**:

```
old binds: 106   new binds: 326
REGRESSIONS (bound before, refuse now): 0
folders lost/moved on a still-binding group: 0
```

### 12.3 Why stopping was cheap

`boxset::run_repair` plans every group first and only writes fold/dissolve afterwards, so an interrupt
during the group loop writes nothing at all. Verified before restarting: 0 folds, 0 dissolves, 0
artists stamped, `LocalRelease` rows touched since run start = 0. The watermark is only stamped on a
clean finish, so the interrupted scope simply stayed pending.

A `#[ignore]`d harness, `boxset::tests::replay_library_dump`, now replays the **real** matcher over a
dump of every sibling group in a library and reports bind/refuse/partial counts. It agreed with the
Python model exactly (347 both before the majority floor, 326 both after), which is what makes the
"0 regressions" claim about the shipped code rather than about a model of it.

---

## 13. Round 2 results (run finished 2026-09-18, 5h05m, 1233 artists)

```
Box groups : 1676 seen, 475 bound (184 folded, 285 dissolved, 6 key-taken, 1 failed, 154 from DB)
  not bound: 1201 - 629 no candidate, 5 fetch error, 489 no match, 55 ambiguous, 22 collision
Re-scored  : 1194 complete, 85 extra tracks, 231 missing tracks, 0 deferred (420 for stale track links)
Identities : Pass A: 0, Pass B: 0, Pass C: 0
Artists stamped: NOT stamped (errors)
```

### Measured against the round-1 baselines

| Measure | Round 1 | Now |
|---|---|---|
| Discs on their own medium | 556 | **823** |
| Dissolved box discs | 771 | **1,214** (295 boxes, was 218) |
| Fold members / folded releases | 3,604 / 1,339 | **4,260 / 1,523** |
| Total placed `LocalRelease` rows | 1,120 | **1,786** (+59%) |
| True unplaced boxes (shape B) | 263 groups / 920 rows | **157 / 410** (−40% / −55%) |
| Stale `mbTrackId` links | 1,336 across 122 releases | **0** |
| Box-disc media with an equivalence | 3,337 | 3,412 |
| Box-placed discs at `UNKNOWN` | 0 | **0** (no regression) |
| `MISSING_TRACKS` rows library-wide | 14,885 | **14,182** (−703) |
| `COMPLETE` rows library-wide | 115,367 | **115,620** (+253) |

Dissolved discs are 1,035/1,214 `COMPLETE` (85%); medium-bound 760/823 (92%).

### Hero cases, all as predicted

| Case | Before | After |
|---|---|---|
| Marillion "The Singles '82-88'" | 12 unplaced cards | folded, **12 members**, 45/45 tracks disc-numbered |
| Marillion "The Singles '89-95'" | unplaced | folded, 10 of 12 — partial bind, 2 odd folders untouched |
| Chuck Berry 16CD | 16 unplaced cards | folded, **15 members**, 1 folder left out |
| Art Tatum "Piano Grand Master" | refused | folded, 4 members |
| ABBA CD4 "Arrival" | stuck on the box | **moved to standalone `Arrival`** via the release-group tie-break |
| HIM "The Single Collection" | 10 cards (round 1 fixed it) | still folded, 10 members, `COMPLETE` |
| Rome "Hall Of Thatch" | bound | **still bound** — the depth-ordering regression candidate |
| Omega "Antológia 1980-85" | bound, 3 folders | **still bound**, all 3 placed |

Rome and Omega are the two groups the first draft of this work would have broken. Both came through
placed and `COMPLETE`, in production, which is the real confirmation that the strictest-depth-first rule
holds.

### The new summary breakdown earns its keep immediately

`629 no candidate` is now the single largest bucket — larger than every matcher refusal combined. Those
groups have no multi-medium MusicBrainz release to bind to at all, so no amount of matcher work reaches
them. Before this run that number was invisible, folded into "seen minus bound", and the matcher looked
like the whole problem. It is not.

### Residual

- **37 discs still carry `boxMediumPosition` with no `boxReleaseId`** (Kraftwerk 8, Bad Company 6,
  Rush 5, …), down from 208. These are groups whose box the orphan sweep had already deleted and whose
  candidate still refuses, so there is nothing to re-link to yet. They restore themselves once the group
  binds.
- **98 box releases are now protected only by the `boxReleaseId` guard**, up from 33 — every one of them
  would be deleted by the old sweep on the next run.
- **A folded box can still score `MISSING_TRACKS` while holding every track — 44 releases.** Measured:
  of 1,518 folded releases, 1,363 are `COMPLETE` and hold every track, 155 are `MISSING_TRACKS`, and of
  those **44 hold every track of the box they are bound to**. The other 111 are genuine partial rips,
  correctly scored.

  Cause, traced on Marillion's fold (45 local tracks against a 45-track box): **the box matcher learned
  new title rules in round 2 and the status scorer did not.** `boxset::pair_tracks_at` now pairs
  "Market Square Heroes (alternative version)" with MusicBrainz's "Market Square Heroes (re-record)" via
  the qualifier-stripping rule, but `status::titles_match` — which decides the *status* — still sees
  equality, then substring containment, then Jaccard over the meaningful words: 3 shared of 6 union =
  0.5, below its 0.8 threshold. One unpaired track out of 45 produces `MISSING_TRACKS`.

  (Checked and ruled out: `status::normalize_title` keeps whitespace, unlike the identically-named
  `owned::normalize_title` which strips it, so the Jaccard branch is live rather than dead. Two
  functions with the same name and different semantics in one crate is its own readability hazard.)

  **Not fixed here, deliberately.** `titles_match` scores every release in the library, not only folded
  boxes; loosening it to recover 44 releases out of 151,928 (0.03%) risks changing status on far more
  than it fixes. If it is taken on, it needs the same treatment the box matcher got: replay both
  versions over the whole library and confirm nothing moves in the wrong direction *before* deploying.
- **`groups_failed > 0` blocks the watermark stamp for the entire scope.** One pathological group means
  a scope can never be marked done. Conservative rather than harmful — every placement still lands — but
  a permanently-failing group would block it forever. The `--artist-ids` scope bypasses the watermark
  anyway, so nothing is pending as a result of this run (2 artists pending, unchanged).

---

## 14. Round 3 — the status scorer (2026-09-18)

Fixes §13's "a folded box can score `MISSING_TRACKS` while holding every track". Cause: round 2 taught
`boxset::pair_tracks_at` new title rules; `status::check_release_status`, which decides the *status*,
never learned them.

### What changed

- The round-2 title rules moved into a shared `title_rules` module, used by both.
- Two scorer passes after the existing ones: **equal once qualifiers are dropped**, and **one- or
  two-letter typos**. Both refuse when the pairing is contested from *either* side, and when the two
  titles name different numbers.
- When the qualifiers differ, the runtimes must be **known on both sides and within 2s**.
- Among identical titles, the exact pass takes the **closest runtime**, not the first file.
- Local durations now reach the scorer at all — `LocalTrackRow` had no `duration` and
  `track_metas_from_rows` hardcoded `None`.
- `tidy --rescore-only`: DB-only re-score including `MISSING_TRACKS`, nothing else, no stamp.

### How the guards were found

Every guard came from replaying both scorers over 23,490 releases (all `MISSING_TRACKS` and
`EXTRA_TRACKS`, plus 5,000 `COMPLETE`) and reading the pairings, not from reasoning about them:

| Draft rule let through | Guard |
|---|---|
| "(mono)" ↔ "(stereo)", MusicBrainz length unknown | differing qualifiers need both runtimes known |
| "Divine Opus #1" ↔ "Divine Opus 2", "Part 1" ↔ "Part II" | numbers must not disagree |
| "(Paul Humphreys remix)" ↔ "(Theo Kottis remix)", 14s apart | differing qualifiers need ≤ 2s |
| "Lil Wayne" reading as the number 99 | explicit roman-numeral whitelist |

The number guard also *added* correct pairings: "Freakish (1)" previously fit both "(take 1)" and
"(take 2)", was contested, and refused; now it resolves.

### Results in production

Rolled out in stages, each checked per release against a snapshot of linked-track counts:

| | |
|---|---|
| Stage 1 (51 artists) | 111 → `COMPLETE`, 39 of 40 predicted, 0 releases lost links |
| Stage 2 (whole library) | 920 more → `COMPLETE` |
| Stage 3 (exact-pass fix) | 3 more → `COMPLETE` |
| **Total `MISSING_TRACKS` → `COMPLETE`** | **1,034** |
| `MISSING_TRACKS` → anything else | 0 |
| Track links gained | 25,452 |
| The 44 mis-scored folded boxes | 36 now `COMPLETE` |

Library: `COMPLETE` 115,620 → 116,654, `MISSING_TRACKS` 14,182 → 13,148.

**Estimated wrong pairings: 1–2%, bounded above by ~5%.** The riskiest class (differing qualifiers)
sampled 33 of 40 clearly one recording labelled two ways, 0 clearly wrong, 7 uncertain — every
uncertain one with runtimes agreeing to the second. One known wrong one shipped: Yello's "She's Got a
Gun (live at the Palladium)" paired with "(Instrumental Club Mix)" 242s/241s, a different bonus track.

**Link clearing.** Stage 2 cleared 26 links across 21 releases, none changing status. Traced: sync
only ever *adds* links, so releases accumulate ones their current scoring doesn't make — a duplicate
file linked alongside its twin (8 releases), pairings from earlier runs. Re-scoring's existing rule
clears what it doesn't re-confirm. Checked and ruled out: nothing links from embedded tag ids, so no
definitive link was removed.

**The replay's one disagreement with production** was file order: the dump didn't order local tracks,
production reads them by disc and track number, and the old exact pass was order-dependent. Re-dumped in
production order, the replay's legacy rules reproduce the stored status on 23,474 of 23,490 releases.

### Open, found during round 3

- **3,603 multi-disc releases stored as `mediumCount = 1` with no medium rows** — 1,745 local releases
  `MISSING_TRACKS` as a result. Reported in `docs/future.md` as 22-20s "Got It If You Want It": CD 1 in
  the release folder, CD 2 in a subfolder, both scored against the full 23-track list. MusicBrainz has 2
  media (13 + 10); the DB recorded 1 and no medium rows, although the tracks carry disc numbers 1 and 2.
  Written by `db::upsert_mb_release`, which hardcodes `medium_count = 1` and never calls
  `sync_mb_media_for_release`. Repairable from the stored disc numbers with no MusicBrainz calls; the
  root-folder-plus-subfolder layout also needs placing, since `find_sibling_groups` never sees it.
- **The legacy loose pass pairs by substring with no duration guard and no length floor.** A local file
  whose tag is just "You" pairs with "What's the Matter With You Baby", "How Sweet It Is (To Be Loved by
  You)", and so on. 102 such links library-wide (≤ 4-letter local title, not equal to the MusicBrainz
  title, runtimes > 15s apart). Fixing it changes existing statuses in the strict direction
  (`COMPLETE` → `MISSING_TRACKS`), so it needs its own replay and a decision.

---

## 15. Round 4 — discs split across a folder and its subfolder (2026-09-18)

Reported in `docs/future.md` as 22-20s "Got It If You Want It": two cards for one album, each showing
`MISSING_TRACKS` and one of its discs. The artist has since been deleted; the examples below stand in.

### Two faults, stacked

**1. Pre-multidisk releases never got their discs.** Discs were first modelled on 2026-09-06/07 (the
`box_sets` and `multidisk` migrations). Those defaulted `mediumCount` to 1 and never backfilled, so
every release synced 2026-08-31 to 09-06 and not re-synced since kept `mediumCount = 1` and no
`MusicBrainzReleaseMedium` rows — although its tracks carried disc numbers 1, 2, … the whole time.
3,602 releases; 3,599 of them written in that one week. Every multi-disc decision keys off
`mediumCount > 1`, so these were invisible to the box pass.

(Corrects §14, which blamed `db::upsert_mb_release` hardcoding one disc. Its only callers create
`MISSING` placeholders, which have no tracks. Sync's binding path records discs properly; nothing
writes this shape today.)

**2. The box pass never saw the layout.** Disc 1 sits in the album folder itself, disc 2 in a folder
beneath it (`…/2004 - Blast Tyrant` and `…/2004 - Blast Tyrant/CD 2 - Bonus Disc`). The box pass groups
folders by common parent, and the root folder's parent is the artist's type folder — so the two discs
were never considered together, even for releases whose discs *were* recorded.

### Fix

- `db::backfill_media_from_track_discs`, a tidy phase before the box pass: medium rows and
  `mediumCount` from the stored disc numbers. Pure SQL, idempotent, only where every track has a disc
  number and there are at least two.
- `boxset::nested_groups`: a root folder plus every folder beneath it, all bound to one multi-disc
  release, none placed or folded. **Discovery only** — the group then goes through the unchanged bind /
  equivalence / fold-or-dissolve pipeline, candidate taken from the database first. Folders in unrelated
  trees are not grouped, and a nested group never overlaps a sibling group, so everything the box pass
  did before it still does identically.

### Verified

Simulated first over all 276 nested groups: 185 bind, every one covering all its folders.

Stage 1, six artists including cases that must not change:

| Album | Before | After |
|---|---|---|
| George Harrison, *All Things Must Pass* 2CD | 2 cards, both `MISSING_TRACKS` | 1 release, 2 disc members, 28/28 linked, `COMPLETE` |
| Clutch, *Blast Tyrant* | 2 cards, both `MISSING_TRACKS` | 1 release, 25/25, `COMPLETE` |
| Carter USM, *Worry Bombe* | 2 cards, both `MISSING_TRACKS` | 1 release, 25/25, `COMPLETE` |
| Circa Survive, two unrelated live albums bound to one release | separate | **unchanged** |
| Garden of Delight, *Lutherion 2* (a sibling group, each disc bound to a different release) | refused | **refused, as before** |

All five groups found folded, all five from the database with no MusicBrainz call, all five re-scored
`COMPLETE`.

Stage 2, every artist owning a nested group (209 artists, 43 minutes; their ordinary sibling groups ran
too):

```
Box groups : 471 seen, 229 bound (172 folded, 52 dissolved, 5 key-taken, 0 failed, 292 from DB)
  not bound: 242 - 54 no candidate, 167 no match, 14 ambiguous, 7 collision
Re-scored  : 385 complete, 10 extra tracks, 5 missing tracks, 0 deferred
```

Checked per release against a pre-run snapshot:

| | |
|---|---|
| `MISSING_TRACKS` → `COMPLETE` | 179 |
| Any other status change | 0 |
| Duplicate cards removed (absorbed into a fold) | 177 |
| Releases that lost track links | 0 |
| Tracks | 1,901,672 before and after |
| Multi-disc releases still stored as one disc | 0 (was 3,602) |

Library: `MISSING_TRACKS` 13,146 → 12,790, `COMPLETE` 116,647 → 116,826.

### Open

- **21 nested groups where the root folder holds two discs at once** — discs 1+2 in the album folder,
  disc 3 below (Scorpions *MTV Unplugged*, Concerto Moon, Kreator *Dying Alive*). Needs a bind plan in
  which one folder covers several discs, a change to `plan_box_bind` itself, which the sibling box pass
  shares. Left for its own replay.
- **2,404 `COMPLETE` releases with no linked tracks at all.** Pre-existing: e.g. Garden of Delight
  *Lutherion 1* was already 0 of 22 before any round-3/4 run, and `--rescore-only` never targets
  `COMPLETE`. Probably a re-index recreating track rows without links while the status stays; not
  verified.

---

## 16. Round 5 — compilations bound to the wrong album by scattered tags (2026-09-18)

Reported as "Billie Holiday - Harold in the Land of Jazz has 2 editions, both extra tracks but seem to
have missing tracks", and "all Chronological Classics seem to have the same problem".

### Cause

A per-track tagger rewrote every file of many budget compilations to wherever it thought that one
recording appeared — album tag, `MUSICBRAINZ_ALBUMID`, and artist tags. "Christmas Moments with Harold
Land": 35 tracks, 31 distinct album ids ("Late Registration", "Born to Die", "Handel: Concerti grossi",
"The Fox (What Does the Fox Say?)"), and "Harold in the Land of Jazz" on 5.

Sync's Tier 1 took the folder's most common id and bound to it on any plurality of two or more
(`majority_from_counts`). Twenty Harold Land compilations collapsed onto that one 8-track album
(`EXTRA_TRACKS`, "exactly the same"); Chronological Classics volumes collected compilations the same
way, since a tagger finds most pre-war jazz there.

Two layers, only the first fixed here:

1. **Binding** — fixed below.
2. **Ownership** — the same scattered per-track artist tags make each compilation *owned* by dozens of
   unrelated artists (Christina Perri, Lana Del Rey, The Prodigy, Ylvis, Handel…), which is how "Harold
   in the Land of Jazz" reached Billie Holiday's page. Index's ownership resolution; not touched.

### Fix (sync `main.rs`)

- Tier 1 binds by tag only when the id is carried by **more than half** the tagged tracks, or its
  **release group** is (a folder tagged across two editions of one album — common and correct).
- A scattered folder's winning id is still fetched (no extra MusicBrainz calls) but bound **only if its
  tracklist scores `COMPLETE`** — keeps a hits compilation that genuinely is that release.
- Tier 2 browses only a release group most tracks agree on.
- A rejected scatter is **not** searched by title: its title comes from the same scattered tags (once
  bound, it *is* the MusicBrainz title), so a search re-finds the scatter's winner. It ends Unmatched.
- `mark_local_release_unmatched` now clears the release's track links; it used to leave them, keeping
  the old release alive in the orphan sweep.

Unanimous and majority ids are untouched: "embedded ids are definitive" still holds for any id the files
agree on.

### Verified

Sample re-matches on production, forced through the new sync:

| Release | Expected | Result |
|---|---|---|
| Harold Land, *Christmas Moments* | unbind | `UNMATCHED` |
| Harold Land, *Triple Trouble Vol. 2* | unbind | `UNMATCHED` |
| Teddy Wilson, *Selected Favorites Vol. 5* | unbind | `UNMATCHED` |
| Lloyd Price, *15 Hits* (scattered tags, tracklist matches) | keep | `COMPLETE` 15/15 |
| Motörhead, *Overkill* (two editions) | keep | `COMPLETE` |
| Within Temptation, *Q-Music Sessions* | keep | `COMPLETE` |
| Teddy Wilson, *Sweet and Simple* (unanimous tags) | keep, by the rule | `MISSING_TRACKS` |

### Repair of existing bindings

Sync never re-examines an already-bound release, so existing damage was repaired directly. The set:
bound through its plurality tag id, no majority for the release or its release group, not `COMPLETE` —
exactly what the new rule rejects, decidable from the database because the stored status *is* the
scorer's verdict against the bound release.

- **2,812** had no other release group with a majority → the new rule's outcome is `UNMATCHED` with no
  MusicBrainz call; applied in one transaction, clearing 24,976 stale track links.
- **7** had another release group with a real majority → re-synced: 2 now `COMPLETE` (Foreigner *Can't
  Slow Down* super deluxe, Velvet Underground *1969 Live*), 4 `UNMATCHED`, 1 bound by agreed-but-wrong
  tags (Electric Mary's live album → studio *Down to the Bone*).
- Completeness recomputed for all 2,521 owning artists.

**Undo record**: `logs/undo16_releases.tsv` (release id, re-sync flag, previous `releaseId`, previous
status) and `logs/undo16_links.tsv` (track id, release id, previous `mbTrackId`) on the NAS.

Library: `MISSING_TRACKS` 12,790 → 11,151, `EXTRA_TRACKS` 4,590 → 3,408, `UNMATCHED` 17,007 → 19,826.
"Harold in the Land of Jazz" went from 20 bound folders to 5 (the 1958 album plus four copies whose tags
genuinely agree on it) and is gone from Billie Holiday's page.

### Open

- **124 Chronological Classics bindings are still wrong**, and deliberately left: their files *agree*
  on a CC volume (59 unanimously, 65 by majority) — the tagger stamped them consistently. Nothing in the
  metadata separates them from a genuine partial album, and folder names are not allowed as evidence.
  Retag the files. List: `docs/scripts/tidy_observations_cc_retag.tsv`.
- **Ownership pollution** (layer 2 above): compilations owned by dozens of unrelated artists through
  scattered per-track artist tags. Same root cause; the fix belongs in index, or in retagging.
