# How sync decides things

**Start here when something in the library looks wrong.** Every ambiguity/tie-break `./sync` makes, and why.

**Rule of thumb:** sync would rather leave something unmatched than match it wrongly. Almost every decision below resolves a tie by refusing rather than guessing. An album that looks wrongly unmatched — the cause is usually one of these refusals, not a crash.

---

## 1. What counts as an album you own

- A **folder is one album** — not a tag, not an MB id. Two copies in two folders = two entries (app groups them on screen).
- MB ids inside files are **not** used to group: a compilation's files each carry the id of the album they were lifted from — grouping by that would shatter one compilation into dozens of fragments. Same fact limits how far those ids are trusted for *matching* (§7).
- Loose files with no folder → grouped by album title + year + artist.
- **Album title/year come from file tags** (most common value across the folder), never the folder name. Once MB matches, its title wins instead.

---

## 2. Who owns an album vs who merely appears on it

- **Owner** = `albumArtist` tag (whose page the album appears on). If it says "Various Artists"/empty, the track's own `artist` tag decides instead.
- **Appears on** = credited on a track but not an owner — gets a credit, not the album.
- Compound names split by **meaning, not punctuation**: `A with B` / `A feat. B` → A owns, B credited. `A & B` / `A, B` → both own.
- **>4 co-billed names = personnel list, not a band** — first name owns, rest credited. (Real case: 44 session musicians on one Sinatra album would've put it on 44 artist pages.)

---

## 3. Turning a name into a real artist

Most damage-prone step — splitting a name wrongly destroys a real band. Measured: of 722 names containing "with", **721 were being split wrongly**, including real bands ("Nurse With Wound", "MAN WITH A MISSION").

**Rule: a separator is never proof of a split.** Sync asks MB if the whole string is a real artist *first*, only splits if definitively not.

Order (cheapest first, most names never reach the internet):
1. Ids embedded in file tags — authoritative, free, believed immediately.
2. A name already looked up before (cached).
3. The whole string as one artist.
4. Splitting into pieces, each proposed grouping checked against MB the same way.
5. Last resort: accept pieces unverified, minus obvious role-words.

- **Separators:** `featuring`, `feat.`, `ft.`, `with`, `vs`, `and`, `&`, `x`, `;`, `,`, `/`, `+`, `·`, `•`, `♦`, `\`, `|`.
- **Not separators:** bare `/` or `+` without surrounding spaces (keeps AC/DC, Florence + the Machine intact); a comma between digits (10,000 Maniacs).
- **A network failure never causes a split** — name left alone, retried later.
- "Various Artists"/"[unknown]"/"[no artist]" recognized as placeholders, skipped entirely.

---

## 4. When two artist entries are the same artist

Two entries are the same **only if both names resolve to the same MB identity** — never similar spelling, never one name containing the other. When same: the entry owning more albums becomes the real one, the other its alias (ties break consistently).

**Got this wrong before (ugly).** Old rule accepted any other entry holding the same identity, no ownership check, no consistent ordering — Bob Dylan's 72 albums sat under "Dylan"; Erroll Garner's 76 sat under "Wardell Gray Quintet". 33 artists affected. `./tidy` sweeps all of these every run (moved off standalone `sync --repair-artist-identities`, `docs/scripts/tidy.md`, `docs/specs/spec_tidy_script.md`).

**Traced (2026-09-10).** Erroll Garner's 76 albums sat under "Wardell Gray Quintet" because one mistagged file (`artist` tag = "Wardell Gray Quintet", embedded MB id = Garner's, wrong). Sync treats an embedded id as definitive and writes it once, permanently — nothing double-checks it names the artist the tag says, and the write only fills an *empty* slot so no later correct answer overwrites it.

A wider version: sync's search step tolerates loose matches to *find releases* — but that tolerance was also used to *accept an identity*. "Wardell Gray Sextet" scored close enough to "Wardell Gray" to count as the same artist. Measured library-wide: **1,269 entries** held an identity contradicting their own name, in **149 groups** sharing one identity wrongly, traceable through **15,493 mistagged embedded-id pairs**.

**Fix (shipped 2026-09-10):** an identity may only be **claimed** when certain — embedded id + independent lookup agree, or exact name match (not approximate). A loose match may still *find* releases, never *claim* an identity. See §5 for which steps may claim, §6 for why the code fix alone doesn't undo existing damage.

---

## 5. Matching phases — find vs. claim

Steps, cheapest/most certain first. Each **finds** releases or **claims** identity — different questions; conflating them is exactly §4's fault.

1. **Embedded id in files.** Normally definitive (§14), believed directly. Exception: if an independent exact lookup of the artist's own name disagrees with the embedded id, the independent answer wins.
2. **Name looked up exactly.** Certain — may claim.
3. **Name searched loosely** (spelling/spacing/word-order tolerant). Only *finds* releases for an artist already believed in — never claims.
4. **Other names on the same tracks** (compound tag's other half, a track's own artist field). Only ever evidence about *that other name* — this is the step that leaked Garner's identity onto the Quintet.

**The whole section boils down to: only an exact, independently-verified match may claim an identity.** A tolerant match only helps find/sync releases.

---

## 6. Repair vs. re-sync — a wrong identity does not fix itself

**A normal sync run, even `--overwrite`, cannot undo a wrongly-claimed identity** — it can only replace one wrong claim with another, or leave it as-is. Re-running sync is not the fix for §4's damage.

Why: once an entry holds an id, ordinary sync trusts it and never re-examines it (§14's whole point — avoid re-asking MB forever). `--overwrite` does re-ask, but if the answer is "not certain enough" (§5) it leaves the entry unmatched for *new* work — it doesn't erase the *old* wrong answer already stored.

So undoing damage is a **repair**, not a **sync**: clears entries whose stored identity contradicts an independent confident answer, re-queues them. `./tidy` runs this every time (formerly `sync --repair-artist-identities`). Running sync harder/more often is not a substitute.

Three sub-passes, in order, every `./tidy` run:
- **Pass A** (`repair_all_empty_primaries`) — a duplicate/alias pair linked by `primaryArtistId` where the empty side's stored id contradicts its own name.
- **Pass B** (`repair_contradicted_identities`) — any entry whose stored id `MbArtistLookup` confidently contradicts (exact-name row, different non-null id). A cache miss/absence is not evidence, left alone.
- **Pass C** (`repair_shared_identities`) — 2+ unrelated entries holding the exact same id. Kept only where exactly one member is independently confirmed; if none, all give it up rather than guess.

B and C also delete the entry's derived `MusicBrainzReleaseArtist` rows — wrong discography disappears immediately.

---

## 7. Matching an album to MusicBrainz

Four attempts, in order. **File tags always win over searching.**

1. **The album id the files agree on.** Believed directly *if* agreement: >half the tagged tracks carry it (or its album group). Tracks with no id don't count against it. When files **don't** agree (id merely won a scatter) — looked up but only bound if its tracklist scores `COMPLETE`. Why it matters: a per-track tagger scattered "Christmas Moments with Harold Land" (35 tracks) across 31 different album ids; believing the scatter winner bound 20 unrelated compilations onto one 8-track album, same for every "Chronological Classics" volume. A compilation that really is the release (tagged per source, every title matching) still binds.
2. **The album-group id most files agree on** — browse its editions, pick one (see "Which pressing" below). A group only a minority carries is not browsed.
3. **Search by title+artist**, only when files carry no usable id. Hit must score ≥85, similar title, allowed type. A folder rejected in step 1 is **not** searched — its title comes from the same scattered tags, search just re-finds the rejected album. Stays unmatched.
4. If files point at something the library refuses to bind (a bootleg), search gets one chance at a legitimate edition instead.

No confident answer → **unmatched**, not guessed. Unmatching also clears track links.

**Rule changes don't re-match existing matches** — sync skips already-matched albums (unless `UNKNOWN` or `--overwrite`). The 2026-09-18 agreement-rule change was applied to existing matches by a one-time repair (`docs/specs/spec_tidy_observations.md` §16): 2,812 compilations unmatched, 7 re-synced.

### Which albums are allowed to match at all
- **Allowed:** Album, EP. Compilations/live/remix/soundtrack ride on those. Remaster/deluxe aren't separate MB types, pass automatically.
- **Rejected:** audiobook, audio drama, spoken word, interview, field recording, demo.
- **Must be Official** — no bootlegs (no status listed = official).
- **Singles never searched/invented** — but a single whose id is *in your files* binds (you demonstrably own the disc). MB files plenty of 4-track CDs as singles; Radiohead's "Creep" sat unmatched for years otherwise.

### Which pressing gets picked
Prefers the edition whose track count exactly matches your folder. Tie-break: same year as your files → CD format → earliest release date. No match among several candidates → refuse, stay unmatched (binding a random pressing = permanently wrong tracklist). Exception: folder has *more* tracks than the matched edition → look for a deluxe edition with the exact count. Fewer tracks = genuine incompleteness, not a wrong edition.

---

## 8. Deciding whether an album is complete

Matches tracks by **title, not position** (order differs between pressings).

Titles match if: identical ignoring case/punctuation/accents; or one contains the other (absorbs "remastered"/"live"/"bonus" suffixes); or share ≥80% of meaningful words (stopwords like "the"/"and"/"of" ignored).

Two more rules, only see what's left unpaired:
- **Equal once trailing "(…)"/"[…]" qualifier dropped** — e.g. "(alternative version)" vs "(re-record)". Without this, a box holding every track scored `MISSING_TRACKS` (Marillion's box: 45/45 present, still "missing"). When qualifiers actually differ, runtimes must be **known on both sides, within 2s**. Punctuation/spacing-only differences keep the usual tolerance.
- **1-2 letter typo** ("Kaleidscope" / typo forms), both runtimes known and within 15s.

Both refuse whenever contested from **either** side, and whenever titles name **different numbers** ("Part 2" ≠ "Part 3", "(take 10)" ≠ "(take 4)"; "Part I"/"Part 1"/"Part One" = same number; a number on only one side = extra detail, not disagreement).

Shipped after replaying both scorer versions over every `MISSING_TRACKS`/`EXTRA_TRACKS` release + 5,000 `COMPLETE`: 0 `COMPLETE`/`EXTRA_TRACKS` changed, 1,013 `MISSING_TRACKS`→`COMPLETE`. Riskiest class (differing qualifiers): 33/40 sampled clearly one recording two ways, 0 clearly wrong, 7 uncertain (all runtimes agreeing to the second). Detail: `docs/specs/spec_tidy_observations.md` §14.

- **Among identical titles, closest runtime wins**, not file order (fixed a real mispairing of two different-length versions of "The Evening's Young").
- **Re-scoring clears links it doesn't re-confirm** — sync only ever adds links, so releases accumulate stale ones over repeated runs. First library-wide `tidy --rescore-only` cleared 26 stale links (21 releases, 0 status changes) while adding 25,446.
- **Identical titles claimed before any loose match is tried** — a bonus disc with many "Song (take N)" variants: matching loosely first let an early plain-titled track steal a "(take 3)" file before the exact pairing ran, producing a false `MISSING_TRACKS` verdict. Fixed by claiming every identical title first, library-wide, loose match only competes for leftovers.

| Status | Meaning |
|---|---|
| Complete | Every official track present, nothing extra |
| Missing tracks | Some official tracks not found |
| Extra tracks | More tracks than the edition lists |
| Unmatched | No confident match |
| Unknown | Needs re-checking — temporary, §10 |

**"Missing tracks" is often not a fault** — e.g. your file is the 2009 remaster where MB lists a 2015 remix, or a differently-spelled title, or a Spanish-language version. Tagging differences, not sync errors.

---

## 9. Box sets and multi-disc albums

MusicBrainz has **no box-set concept.** A box is one release, several discs — no link saying "disc 3 of this box = that standalone album", only shared identity is the *recording*. Everything below reconstructs a relationship MB doesn't record.

### Finding a box

- Side-by-side sibling folders in a parent = candidate discs.
- Second layout: **disc 1's files in the album folder itself, disc 2 in a subfolder beneath it**. Common-parent grouping never sees these together (album folder's parent is the artist type folder). This group only forms when every folder in it is already bound to the same multi-disc release, none placed/folded, and never overlaps a side-by-side group.
- **A release must know it has discs.** Discs were first recorded 2026-09-06/07 — releases matched before that kept `mediumCount=1`/no disc rows despite tracks carrying real disc numbers (3,602 of them). `./tidy` rebuilds disc structure from stored disc numbers first (no MB call); nothing writes that shape anymore.

Candidate box sources, tried in order until one binds:
1. Siblings' own embedded MB ids — majority `MUSICBRAINZ_ALBUMID` tag, looked up directly.
2. The release a sibling is already bound to, if it has >1 medium (tags name the box — §10). Also what makes a library with no embedded MB ids at all still discoverable.
3. MB search on the parent folder's own title (`guess_box_title`) — strips leading year + trailing `(…)`/`[…]` annotation (catalogue numbers in brackets used to return zero hits).
4. Other editions of the same release group, only once all above fail — region/label variants; the ordinary matcher may have bound the wrong edition's tracklist. One extra request, same perfect-match rule (more candidates, not looser).

Ahead of all 4: a group whose folders are **already placed** is rebuilt from stored rows, no MB request. Still re-examined every unscoped run (a disc must still be able to move when a new equivalence appears) — but this skips the redundant cold lookup. Anything incomplete about stored rows falls back to network.

**Why this runs once, at the end of `./tidy`, not per-artist during sync:** a box's siblings and standalone twin can belong to *different* artist rows (compilations, VA sets); fold/dissolve needs every release this run matched already in the DB. Running earlier would also revive §10's matcher-vs-box-pass fight. Formerly ran at the tail of every `sync`; moved to `./tidy` so a folded/dissolved disc gets re-scored in the *same run* (`docs/scripts/tidy.md`).

### Matching folders to discs

Every folder must match exactly one disc, unambiguously, **or the whole group is refused.** Missing discs are fine; an *ambiguous* disc is not.

Ladder, strictest first (a loose match can never steal a track a strict match had a claim on):
1. Identical title, runtime ≤5s.
2. Identical title, runtime ≤15s (rips/masterings shift a few seconds).
3. Identical title, runtime ≤60s, **only when ≥3 tracks on the disc already paired by title** (identity is settled, an outlier is a different master of a proven slot).
4. One title contains the other — only when exactly one candidate fits (ambiguity refused).
5. Titles agree once trailing qualifier dropped (containment can't see this — both sides carry a qualifier, neither contains the other).
6. Near-identical (1-2 char typo) — weakest rule, most constrained: both runtimes must be actually known.

**Order matters:** ABBA's box holds four language versions of "Ring Ring" with runtimes seconds apart — a single loose pass would pair whichever came first; claiming exact titles first removes the risk. Rules 4-6 refuse on any ambiguity.

**Same strictness-first order applies across discs, not just within one** — a folder matching exactly one disc under strict rules keeps it even when a looser rule would also match a second. Without this, 2 boxes on this library stopped binding once a rule widened (one holds two masterings of the same album).

**Every loosening was paid for in real damage:** ABBA's 9-disc box (perfect 9/9 rip) rejected twice — once for "Ring Ring (English version)" vs MB's "Ring Ring", once for a 6s runtime mismatch. Marillion's 12-disc box rejected by one bonus track "(alternative version)" vs MB "(re-record)" — 11/12 discs paired perfectly.

### A folder on no disc at all

A sibling matching **no** disc no longer rejects the group — real rips carry bonus DVD-audio/hi-res/SACD layers, split tracklists. Left out (unchanged, not folded/deleted); rest binds if **≥2** folders still resolve.

An *ambiguous* folder still rejects the whole group — "on no disc" is evidence about one folder, "could be either disc" is evidence the candidate box itself is wrong.

**A majority of folders must resolve, not just two.** Below half, "this is not the box" is the likelier reading; binding anyway folds the few matches while leaving the rest loose (worse than unplaced). Majority rule costs 21/347 binds, removes every case of this shape (Pink Floyd "Oh By The Way" 2/16, Elvis 60CD 10/60). Before the rule: 126 boxes where exactly one folder failed and every other paired perfectly.

### Then: fold, or dissolve?

- **2+ discs recognized as standalone albums → dissolve.** Each shown as the album it reprints, remembering its box.
- **0-1 recognized → fold.** Whole box = one entry. Deliberate, not a failure — many "complete sessions" boxes have discs that don't line up with any original album at all.
- Discs with no standalone equivalent (rarities disc, bonus disc) stay attached to the box.
- A group whose box root folder is **already its own `LocalRelease`** is left alone (reported, not bound) — folding would need deleting/rehoming that other release, a human decision.

### Recognising a disc as a standalone album

Three methods, each tried only on what the previous left unresolved:
1. **Identical set of recordings** — exact/certain (unique ids, no coincidence risk at any track count). Deliberately no minimum track count (a minimum made singles boxes permanently unrecognizable).
2. **Same track titles+lengths, same order** — for older data lacking recording ids.
3. **Disc contains an entire album plus extras** — for a bonus-track edition MB never catalogued separately. Only runs on discs with a name to search, gives up if 2 albums both fit.

Before any of this: dangling `equivalentReleaseId`/`equivalentReleaseGroupId`/`equivalentMediumPosition` (pointing at a deleted release — no FK, orphan sweep doesn't touch it) are cleared first. Tiers 1-3 only ever fill NULL, never correct a stale value. Left dangling, it used to fail the whole repair pass — see next section.

### One box never blocks the rest

Every group binds/folds/dissolves inside its **own error boundary** — a failure is logged (folder path) and counted, pass moves to the next group.

**Not always true — 2 real outages are why this matters.** `run_repair` used to propagate write errors with `?`, killing the loop for every group still to come, every run, until fixed:
- **2026-09-06:** `apply_fold` collided on `groupKey` (box root already its own `LocalRelease` — now the "left alone" case).
- **2026-09-10 (rollout run itself):** `apply_dissolve` hit a dangling `equivalentReleaseId` FK (now prevented, see above).

Between/after those dates, every sync's box pass silently placed **zero** further groups (fixed order by parent path → the failure point blocked everything after it, incl. HIM's box, 588 groups behind, and everything synced after 2026-09-10). The rollout's frozen counts at the time (133 dissolved, 395 fold members — top of `docs/specs/spec_containment_rollout.md`) reflect the abort, not the true total. `apply_dissolve` now writes every member inside one transaction too — no partial-box writes.

---

## 10. Two parts of sync that used to fight

Symptom: **box discs that never got a status**, run after run. Album matcher read each disc's tags (naming the *box*), bound the disc to the box; box pass then moved it to its reprinted album and marked "needs re-checking"; next run, same thing. ABBA's box: 3 consecutive syncs, 9 unscored discs.

**Rule now:** once the box pass has placed a disc, that decision stands. Later `sync` scores the disc where the box pass put it (doesn't re-read tags); deluxe-edition search is skipped for those discs (a box disc legitimately has more tracks, so that search always "succeeded" and restarted the fight); box pass only writes when something changed. `./tidy` never hits this — its own re-score (`docs/scripts/tidy.md` phase 5) scores a just-placed disc in the same run.

**If box discs show "unknown" again after `./tidy`, look here first.**

If every disc of a box sits `MISSING_TRACKS` showing the *box's own* title (scored against every medium) — box pass never placed it. Check `logs/errors.log` for `Box-set repair error`/`box candidate lookup failed` (§9 "One box never blocks the rest"), then `./tidy`'s own summary, which breaks down **why**:

```
Box groups : 1712 seen, 1420 bound (1192 folded, 223 dissolved, 5 key-taken, 0 failed, 230 from DB)
  not bound: 292 - 112 no candidate, 18 fetch error, 130 no match, 29 ambiguous, 3 collision
```

`fetch error` = **not** a settled answer (MB was unwell) — those artists deliberately left unstamped so the next `./tidy` retries. Everything else is a real decision.

---

## 11. Albums you are missing

Lists official albums you don't have, filtered like §5 plus a check the album group has an official release (else bootleg live recordings flood the list).

An album counts **owned** if: any local folder is bound to it, **or** it's a dissolved box disc, **or** every one of its discs is accounted for (without this, every dissolved box would look absent and re-offered).

Fixed ordering bug: missing list used to be built per artist during the run, but boxes only split at the very end — an album whose only copy lived inside a box could stay listed missing. List is now swept again after box splitting.

---

## 12. "You already have these songs, inside something else"

A missing album whose songs all sit inside a compilation/box you own gets a note.

**Owning the songs ≠ owning the album** — a box's version is a different edition/master, which is exactly why MB lists it separately. Album stays listed missing, still a gap, still downloadable — only a note added.

Test: **every** track present, matched to a distinct local track, runtimes within 5s where known. Container must have *more* tracks than the album (exact-size match = it just *is* the album, the matcher's job). Releases under 3 tracks never annotated (would match by coincidence).

The 5s tolerance matters: "In Rainbows: From the Basement" (live) is the same 10 songs as "In Rainbows" but 1-33s off per track — titles alone would call it contained; one honest outlier refuses.

Verified against MB for the 4 largest artists in the library: **108/108 notes correct.**

---

## 13. Talking to MusicBrainz

MB allows ~1 req/s. Sync uses a single shared schedule — 1 request per 1.1s regardless of how many albums are being worked concurrently.

**Working several albums at once ≠ asking faster** — MB is slow to answer (cold request 5-30s), not stingy. Serial: idle ~85% of the time, ~1/6 of the allowance used, full-library pass on track for **~99 days** — the rate limit wasn't the actual bottleneck.

Also fixed:
- **MB cuts long replies short**, sync mistook it for complete — "OK Computer" saw 31 of 39 editions, missing every deluxe edition (exactly what the deluxe search looks for).
- **"Requests remaining" is a shared global counter, not a personal allowance** — sync sped up as it dropped, i.e. went 2× rate exactly when MB was busiest.
- **Timeouts/dropped connections had no retry**, abandoned an entire artist on one blip.

Failures retried by kind: "too fast" slows down, "MB unwell" retries without slowing (slower doesn't fix their server). Typical artist (3 albums): seconds. Largest (70-140 albums): ~1h. Both normal.

---

## 14. Safety rules that override everything

- **Metadata is the truth** — folder/file names never read for artist/album/year.
- **Embedded ids believed immediately — when files agree on them.** One that merely won a scatter is checked against the tracklist first (§7). Artist ids follow §5.
- **Nothing deleted to make a match fit** — ambiguity → unmatched, never deletion.
- **A network failure is never evidence** — defers, never concludes non-existence.
- **Repairs and re-runs are safe to repeat** — same result run once or twice.

---

## 15. Known limits — real ceilings, not bugs

From what MB does/doesn't record. Changing them means guessing.

1. Box disc under 3 tracks can't be identified standalone, stays an unnamed extra.
2. A single disc holding 2 complete albums can only link to one.
3. A box where nothing was ever released separately correctly becomes one entry.
4. Boxes with no disc names (chronological "complete sessions" sets) — can't identify discs. Most common box shape.
5. A remaster re-split across a different disc count than any standalone edition can't be lined up.
6. A box-exclusive "lost album" and a plain rarities disc look identical to MB.
7. **A standalone album can only be recognized by recordings if MB gave every track a recording id.** Missing even one → falls back to titles/runtimes (refuses far more often). Measured: **42.5%** of single-disc releases (48,303/113,702) unusable as an exact target. Single largest reason boxes fold rather than dissolve — an MB data gap, not a decision made here.

---

## 16. Deploying and running an identity repair

**Order matters — backwards undoes the fix.** §5's certainty gate must be live *before* the repair runs, or the very next ordinary sync writes the wrong identity straight back.

A relink/resync running concurrently is fine, not a substitute — per §6 it can't clear an already-stuck wrong identity, only the dedicated repair does.

Order:
1. Deploy the code carrying §5's certainty gate.
2. Run `./tidy` (no `--dry-run` — same "no preview, `./backup` is the recovery path" as the box pass). Nulls wrong identities, clears piled-up discography — does **not** itself re-sync anything.
3. Normal unscoped `./sync` picks the now-empty entries back up as ordinary pending work. No need to force library-wide `--overwrite` — only touched entries need re-deriving, they re-enter the queue on their own.

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

## 18. Where to start digging

| Symptom | Section |
|---|---|
| Album on the wrong artist's page | §2, §3 |
| Artist page under the wrong name, or duplicated | §4 |
| One artist's albums on a *different, unrelated* artist's page | §4, §5, §6 |
| Album shows unmatched but obviously exists | §7 |
| Wrong pressing / wrong track list | §7 |
| "Missing tracks" on an album that looks complete | §8 |
| Box set shown as one lump, or as scattered discs | §9 |
| Box discs stuck on "unknown" across runs | §10 |
| Box seen by `./tidy` but never bound | §10 — run summary's `not bound:` line says why |
| Several identical-looking cards for one release | §9, §10, §17 |
| Album listed missing that you own | §11, §9 |
| Several unrelated compilations shown as the same album | §7 |
| Disc 1 in folder, disc 2 in subfolder shown as two cards | §9 "Finding a box" |
| An artist that owns albums but was never synced | §19 "Gaps in sync and tidy" |
| "Songs inside another release" note looks wrong | §12 |
| Sync too slow, or MB errors | §13 |
| Ran `./tidy` but wrong albums still there | §6 — repair clears the id, doesn't re-sync; next `sync` does |

Useful commands: `./tidy`, `./sync --only "Artist" --exact --verbose`, `./audit`.

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

### 8. Albums owned by dozens of unrelated artists (scattered per-track artist tags)
**Symptom:** a Harold Land compilation shows on Christina Perri's, Lana Del Rey's, etc. pages.
**Cause:** same per-track tagger as §7 also scattered album-artist tags; §2's owner rule unions every track's album artist. Post-§7 binding fix these are Unmatched under their own name but still owned by everyone the tagger named.
**Fix:** belongs in index's ownership resolution (majority-agreement test on album artists, fallback to folder's dominant owner) — or retag.

### 9. 124 "Chronological Classics" bindings still wrong — needs retagging, not code
Files **agree** (59 unanimously, 65 by majority) on a CC volume — tagger was internally consistent (every pre-war recording appears on some volume). §7's agreement rule correctly believes them; nothing in metadata distinguishes this from a genuine partial album, folder names aren't evidence (§14). Retag the files. List: `docs/specs/spec_tidy_observations_cc_retag.tsv`.

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

---

## 20. Stopping and restarting a NAS sync/tidy run

Learned 2026-09-13 rollout. Two NAS quirks make the obvious commands wrong:

- **`/tmp` is mounted `noexec`.** A script placed there can't be *executed* directly — inside `tmux new-session -d` that failure kills the pane, then the session, then (no other session left) **the tmux server itself**, so `tmux ls` right after reports "no server running" (tmux isn't actually broken). Always `bash /tmp/foo.sh`, never bare `/tmp/foo.sh`.
- **Killing the local shell around a `docker exec` does NOT kill the process inside the container.** An orphaned `sync`/`tidy` keeps running server-side, keeps heartbeating the DB lock every 60s (so `clear_stale_lock_minutes` never fires), while `ps`/`tmux ls` outside show nothing and the log file stops growing. Don't assume "stopped" — check the lock.

### Check what's running
```bash
ssh nas 'tmux ls; sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp -c \
  "SELECT \"scanLockedBy\", \"scanPid\", \"scanLockedAt\" FROM \"Statistics\" WHERE id='"'"'main'"'"';"'
```
Empty `scanLockedBy` = nothing running, safe to start. A `scanPid` with no matching tmux session = the orphan case above.

### Stop it (graceful SIGTERM, releases lock cleanly)
```bash
ssh nas 'sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp -t -c \
  "SELECT \"scanPid\" FROM \"Statistics\" WHERE id='"'"'main'"'"';"'
# take the pid, then:
ssh nas 'sudo docker exec dmp bash -c "kill -TERM <pid>"'
# verify scanLockedBy is now empty
```
`kill` isn't a standalone binary in the bookworm-slim `dmp` image — always `docker exec dmp bash -c "kill ..."`, never `docker exec dmp kill ...`.

**Always stop this way before `./deploy`** — a deploy recreates the `dmp` container, killing anything inside far less cleanly than SIGTERM.

### Restart it
Use deployed wrapper scripts directly, with `sudo` (they're on the SSD mount, `noexec` doesn't apply; the wrapper's own `docker exec` has no `sudo` baked in):
```bash
ssh nas 'tmux new-session -d -s sync "sudo /mnt/SSD/web/dmp/sync > /tmp/sync-run.log 2>&1; echo DONE_SYNC >> /tmp/sync-run.log"'
```
Resumes via its own run-hash (`Resuming run (hash: …)` in the log) — no flags needed. Same pattern for tidy after sync finishes (`docs/specs/spec_tidy_script.md` Step 10):
```bash
ssh nas 'tmux new-session -d -s tidy "sudo /mnt/SSD/web/dmp/tidy > /tmp/tidy-run.log 2>&1; echo DONE_TIDY >> /tmp/tidy-run.log"'
```
(`sudo docker exec dmp sync`/`tidy` works identically if the wrapper is missing — that's what it falls back to internally, which is always true on the NAS.)

### Watch progress
```bash
ssh nas 'tail -30 /tmp/sync-run.log'
ssh nas "grep -oE '\[[0-9]+/[0-9]+\]  [A-Za-z]' /tmp/sync-run.log | tail -1"   # artist-level counter (double space disambiguates from per-release lines)
ssh nas 'grep -c DONE_SYNC /tmp/sync-run.log'   # >0 once finished
```

### If a script file is genuinely needed (e.g. scoped `--only "A;B;C"`)
```bash
ssh nas 'bash /tmp/whatever.sh'                                    # fine
ssh nas 'tmux new-session -d -s x "bash /tmp/whatever.sh"'         # fine
ssh nas 'tmux new-session -d -s x "/tmp/whatever.sh"'              # BREAKS — noexec, kills tmux
```
