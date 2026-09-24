# Sync decisions — history

Dated investigations, measurements, and the to-do list they produced, split out of
`docs/sync_decisions.md` to keep that file a pure current-behavior reference. Section numbers below
match the numbering they had in `sync_decisions.md` at the time they were split out (§17, §19) - code
comments citing "§17"/"§19 item N" refer to this file.

## 17. Measurements — 2026-09-10 identity investigation (closed)

Before fix: 1,269/39,684 artist entries held a contradicting identity (1,646 albums), 149 groups wrongly sharing one identity. After §5's gate shipped + repair ran: **0 contradicting entries**, confirms held steady (37,382→37,394). Pass B cleared 1,268 identities; Pass C resolved 17/149 shared-id groups (rest collapsed once Pass B ran). Immediate re-run: 0/0/0 — repair doesn't re-touch what it fixed.

**11 shared-id groups deliberately left unmerged** — not the ambiguous collision Pass C targets (both members independently confirm the same id), but one real MB artist filed under two local `Artist` rows (full name vs surname, MB alias pair) — a **duplicate-row merge** job instead (`index --canonicalize-artists`/§4's `primaryArtistId`). Examples: Jorge Ben/Jorge Ben Jor, Soda/Soda Stereo, Henderson/Joe Henderson, Prague Philharmonic Orchestra's 3 spellings.

### Measurements — 2026-09-11 box-set investigation

HIM's box showing as 10 identical cards triggered this. **Use this query** (the doc's original one over-counted — counted every `LocalRelease` under a flagged parent including correctly-placed ones, inflating 3,411 "unplaced" to a real 1,613):

```sql
WITH lr AS (SELECT lr.*, regexp_replace(lr."folderPath", '/[^/]+$', '') parent
            FROM "LocalRelease" lr WHERE lr."folderPath" IS NOT NULL
              AND array_length(string_to_array(lr."folderPath", '/'), 1) >= 4)
SELECT count(*) AS groups, sum(n) AS rows FROM (
  SELECT lr.parent, lr."releaseId", count(*) n
  FROM lr JOIN "MusicBrainzRelease" m ON m.id = lr."releaseId"
  WHERE m."mediumCount" > 1 AND lr."mediumPosition" IS NULL AND lr."boxReleaseId" IS NULL
  GROUP BY 1, 2 HAVING count(*) > 1) t;
```

Grouping by `releaseId` too separates: several folders bound to **one** multi-disc release = an unplaced box; several folders each bound to a **different** multi-disc release = usually a wrong-edition bind (§19 item 1a), not a box.

| Measure | Count |
|---|---|
| Split-disc groups bound to `mediumCount>1` but never placed | 1,300 |
| Unplaced disc rows in those groups | 3,411 (2,713 `MISSING_TRACKS`, 588 `UNKNOWN`) |
| `equivalentReleaseId` pointing at a deleted release | 35 / 14,001 |
| Groups with fold-key collision (box root already its own `LocalRelease`) | 10 |
| Groups a Python replay of `plan_box_bind` says bind cleanly once fixed | 988 |
| Groups correctly refused (no-match/ambiguous/collision) | 312 (280/31/1) |

---

## 19. To do next

Self-contained items: symptom, cause, fix, safety, verification. Items 1-5 from the 2026-09-11 box-set investigation (§17); 6-13 from the 2026-09-18 tidy rollout review (`docs/specs/spec_tidy_observations.md`). Done items kept, marked, numbering stable.

### 1. Refused split-disc groups — **done (2026-09-18)**
- **(a) Bound release is a different edition than the rip** — `run_repair` now falls back to the release group's other editions when every existing candidate fails (§9 discovery source 4). Same rule, more candidates.
- **(b) An extra sibling on no disc of any edition** — left out instead of refusing the group, if ≥2 folders still resolve and none ambiguous (§9 "A folder on no disc at all").

Matcher also gained: corroborated 60s drift, qualifier-stripped equality, typo tolerance, plus disc-level strictness ordering. Replayed old vs new over every sibling group: **106→347 bind, 0 regressions, 0 folders moved.** Detail: `docs/specs/spec_tidy_observations.md`.

### 2. Shared multi-medium releases across different parent folders (370 releases, 1,581 rows)
**Symptom:** unlike #1, folders in **different** parents bound to one multi-medium release (same §17 query, drop the parent grouping, group by `releaseId` with `count(DISTINCT parent)>1`).
**Cause:** almost certainly duplicate copies filed under two folder names (`project_shared_releaseid_mismatch`: 99.4% same-title duplicates, not real mismatches). Minority: a box's discs genuinely filed apart.
**Fix:** classify via `common::release_pairs`. True duplicate → `./audit --duplicate-release` review flow (existing). Genuinely separated discs → medium-level bind **without folding**: pair each folder to one medium, set `mediumPosition` directly (no move/delete, no `LocalReleaseMember`) — smaller than §9's fold/dissolve.
**Verify:** every one of the 370 ends up queued as duplicate or on a distinct `mediumPosition`.

### 3. Dissolved boxes re-fetched from MB on every unscoped run — **done (2026-09-18)**
Already-placed groups now rebuilt from stored rows (§9 discovery, "Ahead of all four") — still visited, re-linked, goes through fold/dissolve (a disc can still move on new equivalence), just no MB request. Before: 230 groups/1,113 folders paying a cold lookup (~10s) for nothing.

### 4. Cover-art embedding strips MusicBrainz frames from MP3s
**Symptom:** MP3 with a Picard-written TXXX (`MusicBrainz Album Id`/`Release Group Id`/`Release Track Id`) loses it on the first cover-art embed. Same lofty generic-`Tag` bug as `CLAUDE.md`'s MP3 note (fixed for `common::tags` 2026-09-11), not fixed at every call site.
**Still happens in:** `common::images::embed_cover_art` (every sync downloading new art), `fix/src/tags.rs`, `problems/src/fix/tags.rs` — all resave MP3 via lofty's generic `Tag`.
**Consequence for §9:** an MP3 box disc losing `MUSICBRAINZ_ALBUMID` this way becomes invisible to tier (a) discovery again after the next cover-art embed, even after a SongKong re-tag, until re-indexed.
**Fix:** route MPEG writes through the concrete `Id3v2Tag` type in all 3 writers, same as `common::tags`'s `MbSlots`. `Id3v2Tag::insert_picture` covers cover art.
**Measure first:** sample MP3s whose indexed `LocalReleaseTrack.metadata` snapshot had `MusicBrainzReleaseId`, check if the *current* file still has it.
**Verify:** ffmpeg fixture with real TXXX frames (`scripts/common/tests/tags_roundtrip.rs::mp3_resave_keeps_existing_musicbrainz_frames`), embed cover through each fixed writer, confirm frames survive.

### 5. Recording-tags cleanup + box-set rollout — **superseded, see `docs/specs/spec_tidy_script.md`**
Separate bug: `common::tags::write_mb_ids` used to write a track's release-track id into the recording-id slot. Fixed and deployed (`3549964b`). The repair flag was removed; replaced by `oneoff/repair_recording_tags.py`, which didn't actually run until 2026-09-18 (Python 3.11 parse error) — fixed, validated, run, deleted (`docs/specs/spec_tidy_observations.md` §17). The box-set rollout this item used to block on is also superseded: binding moved off sync's tail entirely into `./tidy`. **Current checklist: `docs/specs/spec_tidy_script.md` Step 10.**

### 6. Root folder holding two discs at once, next disc below (21 albums)
**Symptom:** discs 1+2 in the album folder, disc 3 in a subfolder (Scorpions "MTV Unplugged", Kreator "Dying Alive", Concerto Moon "Decade Of The Moon") — both `MISSING_TRACKS`.
**Cause:** bind plan pairs each folder with exactly one disc; the album folder matches none, only the subfolder resolves → refused.
**Fix:** let a folder pair with a *contiguous run* of discs when no single one matches, against the run's combined tracklist. `apply_fold` must stamp disc number from which disc the pairing landed on, not the folder.
**Safety:** changes `plan_box_bind` (shared with the side-by-side pass) — replay old vs new first (`boxset::tests::replay_library_dump`).

### 7. A 9-track folder bound to a 257-track box ("Dear Michael: The Motown Collection")
**Symptom:** 3 different Michael Jackson albums bound to one 12-disc box, 3 identical cards.
**Cause:** not the box pass (folders are separate albums, not discs). No embedded album id on any file — album matcher reached the box by search/edition choice, which §7's rules shouldn't allow for a 9-track folder vs. a 257-track box. Box pairs 2 albums per disc, so no per-disc placement exists either (§15 limit 2). Start in the album matcher's search/edition path.
**Unaffected by the 2026-09-22 no-guessing change** — this is a Tier 3 search/edition-choice bug, not a tag-agreement one; the consensus gate runs before any tier and has nothing to say about which edition a title search picks.

### 8. Albums owned by dozens of unrelated artists (scattered per-track artist tags)
**Symptom:** a Harold Land compilation shows on Christina Perri's, Lana Del Rey's, etc. pages.
**Cause:** same per-track tagger as §7 also scattered album-artist tags; §2's owner rule unions every track's album artist. Post-§7 binding fix these are Unmatched under their own name but still owned by everyone the tagger named.
**Fix:** belongs in index's ownership resolution (majority-agreement test on album artists, fallback to folder's dominant owner) — or retag.

### 9. 124 "Chronological Classics" bindings still wrong — needs retagging, not code
Files **agree** (59 unanimously, 65 by majority) on a CC volume — tagger was internally consistent (every pre-war recording appears on some volume). §7's agreement rule correctly believes them; nothing in metadata distinguishes this from a genuine partial album, folder names aren't evidence (§14). Retag the files. List: `docs/specs/spec_tidy_observations_cc_retag.tsv`.
**2026-09-22 update:** the 65 majority-bound rows no longer bind at all — the no-guessing rule (§7, `docs/no_guessing.md`) requires unanimity, and a majority-only agreement is now `UNKNOWN` with `MB_ALBUM_DIVERGENCE` (or the RG-unanimous variant). The 59 unanimously-bound rows are unaffected. Retagging is still the real fix for both.

### 10. 2,404 Complete albums with no linked tracks at all
Pre-existing (e.g. Garden of Delight "Lutherion 1": Complete, 0/22 linked), `tidy --rescore-only` never targets Complete. Suspected: re-index recreating track rows without links while status stays. **Not verified** — compare `LocalReleaseTrack.createdAt` to last scoring.

### 11. Loose title containment pairs one-word titles with anything (102 links)
A file tagged just "You" pairs with unrelated long titles containing "You" — §8's containment rule has no length floor/duration check. Fixing it moves some `Complete`→`Missing tracks` — needs its own replay + decision.

### 12. Box discs whose box was deleted (37 remaining)
`boxMediumPosition` set, no `boxReleaseId` — orphan sweep used to delete dissolved boxes (fixed 2026-09-18, `docs/specs/spec_tidy_observations.md` §12). 208 were damaged, 171 recovered on re-bind; rest recover once their group binds.

### 13. Artists that owned albums were never synced — **done (2026-09-18)**
Index's post-scan resolution replaces a provisional compound owner with the artists it names (often creating them) but never stamped their `lastIndexedAt` — sync only selects artists that have one. 5,445 owning artists never synced, 437 albums owned only by them never matched (406 Unmatched). Fixed: resolution pass now stamps every artist it adds as owner. Existing 5,490 backfilled once (`logs/undo17_never_indexed.txt`).

### Gaps in sync and tidy
Not bugs, but things neither does:
- **Sync never re-examines an already-matched album.** Every matching-rule change (§7, §8) needs a one-off repair to reach existing matches. `tidy --rescore-only` covers *scoring* changes only, nothing covers *matching* changes. A standing check (tidy flagging matches the current rules would reject, setting `UNKNOWN`) would make this self-healing.
- **One persistently failing box group blocks the whole run's "tidied" stamp** for every artist in scope, not just the failing group's. Conservative, not wrong, but a permanently-failing group blocks a scope forever. Should attribute to that group's artists only, like fetch errors already do.
- **An artist held back after an MB failure may not be the one that pulled the group in** (`artist_for_group` picks any owner) — group stays unbound regardless, resurfaces eventually, but it's a nudge not a guarantee.
- **`tidy --rescore-only` doesn't run the orphan sweep** — releases a re-score leaves unreferenced wait for the next ordinary tidy.
- **Sync only ever adds track links** — only tidy's re-score clears unconfirmed ones, so an album sync re-matches but tidy never re-scores can keep stale links.

## Box-repair error boundary — two outages that motivated it

`run_repair` used to propagate a group's write error with `?`, killing the loop for every group still
to come, in a fixed processing order, every run, until fixed. Two distinct causes hit this in
production: a `groupKey` collision when a box root was already its own `LocalRelease` (now the "left
alone" case in §9), and a dangling `equivalentReleaseId` FK from a deleted release (now cleared up
front before fold/dissolve runs, also §9). Between the first occurrence and the fix, every sync's box
pass silently placed zero further groups past the failure point — a large box behind the failure point
sat unbound for days, and every run afterwards re-hit the same wall. A contemporaneous rollout's
frozen counts (roughly 130 dissolved, 400 fold members, at the top of
`docs/specs/spec_containment_rollout.md`) reflect that abort, not the true total once the fix landed.
Fixed by giving each group its own error boundary (§9 "One box never blocks the rest") and making
`apply_dissolve` write every member inside one transaction, so a partial-box write can't happen either.

---
