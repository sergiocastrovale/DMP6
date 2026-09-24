# How sync decides things

**Start here when something in the library looks wrong.** Every ambiguity/tie-break `./sync` makes, and why.

**Rule of thumb:** sync would rather leave something unmatched than match it wrongly. Almost every decision below resolves a tie by refusing rather than guessing. An album that looks wrongly unmatched — the cause is usually one of these refusals, not a crash.

---

## 1. What counts as an album you own

- A **folder is one album** — not a tag, not an MB id. Two copies in two folders = two entries (app groups them on screen).
- MB ids inside files never drive grouping: a compilation's files each carry the id of the album they were lifted from — grouping by that would shatter one compilation into dozens of fragments. Same fact limits how far those ids are trusted for *matching* (§7).
- Loose files with no folder → grouped by album title + year + artist.
- **Album title/year come from file tags** (most common value across the folder), never the folder name. Once MB matches, its title wins instead.

---

## 2. Who owns an album vs who merely appears on it

- **Owner** = `albumArtist` tag (whose page the album appears on). If it says "Various Artists"/empty, the track's own `artist` tag decides instead.
- **Appears on** = credited on a track but not an owner — gets a credit, not the album.
- Compound names split by **meaning, not punctuation**: `A with B` / `A feat. B` → A owns, B credited. `A & B` / `A, B` → both own.
- **>4 co-billed names = personnel list, not a band** — first name owns, rest credited. (Without this, a large personnel-credit album with dozens of session musicians listed would put it on every one of their artist pages.)

---

## 3. Turning a name into a real artist

Most damage-prone step — splitting a name wrongly destroys a real band. Measured across the library:
names containing the word "with" were overwhelmingly real band names, not two artists joined by a
separator — a naive split-on-separator rule would have broken nearly all of them.

**Rule: a separator is never proof of a split.** Sync asks MB if the whole string is a real artist *first*, only splits if definitively not.

Order (cheapest first, most names never reach the internet):
1. Ids embedded in file tags — authoritative, free, believed immediately.
2. A name already looked up before (cached).
3. The whole string as one artist.
4. Splitting into pieces, each proposed grouping checked against MB the same way.
5. Last resort: accept pieces unverified, minus obvious role-words.

- **Separators:** `featuring`, `feat.`, `ft.`, `with`, `vs`, `and`, `&`, `x`, `;`, `,`, `/`, `+`, `·`, `•`, `♦`, `\`, `|`.
- **Not separators:** bare `/` or `+` without surrounding spaces (keeps names like "AC/DC" or a "+"-joined band name intact); a comma between digits (an artist name containing a spelled-out large number).
- **A network failure never causes a split** — name left alone, retried later.
- "Various Artists"/"[unknown]"/"[no artist]" recognized as placeholders, skipped entirely.

---

## 4. When two artist entries are the same artist

Two entries are the same **only if both names resolve to the same MB identity** — never similar spelling, never one name containing the other. When same: the entry owning more albums becomes the real one, the other its alias (ties break consistently).

**Why not "any row holding the same identity":** with no ownership check and no consistent ordering,
one mistagged file (a track's `artist` tag naming one artist while its embedded MB id points at a
completely different one) is enough to permanently misfile an artist's whole discography under the
wrong name - the write only fills an *empty* identity slot, so no later correct answer overwrites it,
and the effect compounds across every album that artist owns. `./tidy` sweeps for this every run
(moved off standalone `sync --repair-artist-identities`, `docs/scripts/tidy.md`,
`docs/specs/spec_tidy_script.md`).

A wider version of the same risk: sync's search step tolerates loose matches to *find releases* - that
tolerance must never also decide *acceptance of an identity*. A merely-similar name (e.g. a band's studio
vs. live lineup billing) can score close enough to count as the same artist under a loose match, which
is exactly the shape that lets one artist's catalogue silently absorb another's.

**The fix:** an identity may only be **claimed** when certain - embedded id + independent lookup
agree, or exact name match (not approximate). A loose match may still *find* releases, never *claim*
an identity. See §5 for which steps may claim, §6 for why the code fix alone doesn't undo existing
damage.

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

**No guessing (see `docs/no_guessing.md`).** Before any of the tiers below run, a folder's
album tag and embedded MB id(s) must be **unanimous** across its tracks (`common::consensus::evaluate`)
— never a plurality/majority vote, never a "rescue" by tracklist score. Untagged tracks are absent
evidence, not a veto. Not unanimous → the release is parked `UNKNOWN` with a human-readable
`statusReason` and never reaches MusicBrainz at all this run. Exempt: a dissolved box disc (its
placement comes from the box pass below, not from tags) and a folded multi-disc survivor (legitimately
mixes per-disc tags).

Three tiers, in order, over the unanimous ids/title the gate already established. **File tags always
win over searching.**

1. **The album id every tagged track agrees on.** Looked up directly, bound as-is — no confirmation
   step, because unanimity is already the confirmation. A plurality vote is never enough: a per-track
   tagger can scatter one album's tracks across many different album ids, and believing the scatter's
   winner risks binding a handful of tracks that happen to share an id onto a release most of the
   folder's tracks disagree with. Those folders park `UNKNOWN` instead, see §15.
2. **The album-group id every tagged track agrees on** (or Tier 1's release id's own group, if Tier 1
   404'd — MB has deleted/merged the release since the file was tagged) — browse its editions, pick
   one (see "Which pressing" below).
3. **Search by title+artist**, only when the folder carries no usable id at all — which, thanks to the
   gate above, means the title itself is unanimous too. Hit must score ≥85, similar title, allowed
   type.

No confident answer → **unmatched**, not guessed. Unmatching also clears track links.

**Rule changes don't re-match existing matches** — sync skips already-matched albums (unless `UNKNOWN`
or `--overwrite`). A tightened matching rule needs its own one-time repair pass to reach releases
matched under the old rule; see `docs/specs/spec_tidy_observations.md` and §19 for worked examples of
that pattern.

### Which albums are allowed to match at all
- **Allowed:** Album, EP. Compilations/live/remix/soundtrack ride on those. Remaster/deluxe aren't separate MB types, pass automatically.
- **Rejected:** audiobook, audio drama, spoken word, interview, field recording, demo.
- **Must be Official** — no bootlegs (no status listed = official).
- **Singles never searched/invented** — but a single whose id is *in your files* binds (you demonstrably own the disc). MB files plenty of multi-track CDs as singles; without this a legitimately-owned single would otherwise sit unmatched forever.

### Which pressing gets picked
Prefers the edition whose track count exactly matches your folder. Tie-break: same year as your files → CD format → earliest release date. No match among several candidates → refuse, stay unmatched (binding a random pressing = permanently wrong tracklist). A folder with *more* tracks than the matched edition scores `EXTRA_TRACKS` rather than hunting a bigger sibling edition — searching for a bigger edition to "upgrade" into risks the same unanimity-violating guess this section rules out elsewhere, and `stampMerged` already treats `EXTRA_TRACKS` as keepable. Fewer tracks = genuine incompleteness, scores `MISSING_TRACKS`.

---

## 8. Deciding whether an album is complete

Matches tracks by **title, not position** (order differs between pressings).

Titles match if: identical ignoring case/punctuation/accents; or one contains the other (absorbs "remastered"/"live"/"bonus" suffixes); or share ≥80% of meaningful words (stopwords like "the"/"and"/"of" ignored).

Two more rules, only see what's left unpaired:
- **Equal once trailing "(…)"/"[…]" qualifier dropped** — e.g. "(alternative version)" vs "(re-record)". Without this, a box holding every track can still score `MISSING_TRACKS` purely because of qualifier wording. When qualifiers actually differ, runtimes must be **known on both sides, within 2s**. Punctuation/spacing-only differences keep the usual tolerance.
- **1-2 letter typo** ("Kaleidscope" / typo forms), both runtimes known and within 15s.

Both refuse whenever contested from **either** side, and whenever titles name **different numbers** ("Part 2" ≠ "Part 3", "(take 10)" ≠ "(take 4)"; "Part I"/"Part 1"/"Part One" = same number; a number on only one side = extra detail, not disagreement).

Rule changes here are validated by replaying both scorer versions over the full library before shipping: every release currently scored `MISSING_TRACKS`/`EXTRA_TRACKS`, plus a large `COMPLETE` sample, checked for any regression in the safe direction before rollout. Detail: `docs/specs/spec_tidy_observations.md` §14.

- **Among identical titles, closest runtime wins**, not file order (guards against mispairing two different-length versions of the same title).
- **Re-scoring clears links it doesn't re-confirm** — sync only ever adds links, so releases accumulate stale ones over repeated runs. A library-wide `tidy --rescore-only` run clears every stale link it finds while adding freshly-confirmed ones, with no status changes from the cleanup itself.
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
- **A release must know it has discs.** A release matched before disc structure was recorded can hold `mediumCount=1`/no disc rows despite its tracks carrying real disc numbers. `./tidy` rebuilds disc structure from stored disc numbers first (no MB call) to repair this; nothing writes that shape anymore.

Candidate box sources, tried in order until one binds:
1. Siblings' own embedded MB ids — **unanimous** `MUSICBRAINZ_ALBUMID` tag (see `docs/no_guessing.md`
   for why unanimous, not a majority), looked up directly. `NULL` when a sibling's tracks disagree on
   it or carry none.
2. The release a sibling is already bound to, if it has >1 medium (tags name the box — §10). Also what makes a library with no embedded MB ids at all still discoverable.
3. MB search on the parent folder's own title (`guess_box_title`) — strips leading year + trailing `(…)`/`[…]` annotation (a bracketed catalogue number in the title would otherwise return zero hits).
4. Other editions of the same release group, only once all above fail — region/label variants; the ordinary matcher may have bound the wrong edition's tracklist. One extra request, same perfect-match rule (more candidates, not looser).

Ahead of all 4: a group whose folders are **already placed** is rebuilt from stored rows, no MB request. Still re-examined every unscoped run (a disc must still be able to move when a new equivalence appears) — but this skips the redundant cold lookup. Anything incomplete about stored rows falls back to network.

**Why this runs once, at the end of `./tidy`, not per-artist during sync:** a box's siblings and standalone twin can belong to *different* artist rows (compilations, VA sets); fold/dissolve needs every release this run matched already in the DB. Running earlier would also revive §10's matcher-vs-box-pass fight. Running it as part of `./tidy` (rather than at the tail of every `sync`) also lets a folded/dissolved disc get re-scored in the *same* run (`docs/scripts/tidy.md`).

### Matching folders to discs

Every folder must match exactly one disc, unambiguously, **or the whole group is refused.** Missing discs are fine; an *ambiguous* disc is not.

Ladder, strictest first (a loose match can never steal a track a strict match had a claim on):
1. Identical title, runtime ≤5s.
2. Identical title, runtime ≤15s (rips/masterings shift a few seconds).
3. Identical title, runtime ≤60s, **only when ≥3 tracks on the disc already paired by title** (identity is settled, an outlier is a different master of a proven slot).
4. One title contains the other — only when exactly one candidate fits (ambiguity refused).
5. Titles agree once trailing qualifier dropped (containment can't see this — both sides carry a qualifier, neither contains the other).
6. Near-identical (1-2 char typo) — weakest rule, most constrained: both runtimes must be actually known.

**Order matters:** a box can hold several near-duplicate versions of the same title (e.g. different language pressings) with runtimes seconds apart — a single loose pass would pair whichever came first; claiming exact titles first removes the risk. Rules 4-6 refuse on any ambiguity.

**Same strictness-first order applies across discs, not just within one** — a folder matching exactly one disc under strict rules keeps it even when a looser rule would also match a second. Without this, widening a rule for one disc can cause a box that holds two masterings of the same album to stop binding at all.

**Every loosening was paid for in real damage:** a perfect full-disc rip has been rejected outright over a single-word title variant against MB's own spelling, and separately over a runtime mismatch of a few seconds; another box was rejected wholesale by one bonus track's qualifier wording, despite every other disc pairing perfectly.

### A folder on no disc at all

A sibling matching **no** disc no longer rejects the group — real rips carry bonus DVD-audio/hi-res/SACD layers, split tracklists. Left out (unchanged, not folded/deleted); rest binds if **≥2** folders still resolve.

An *ambiguous* folder still rejects the whole group — "on no disc" is evidence about one folder, "could be either disc" is evidence the candidate box itself is wrong.

**A majority of folders must resolve, not just two.** Below half, "this is not the box" is the likelier reading; binding anyway folds the few matches while leaving the rest loose (worse than unplaced). This costs a small minority of otherwise-plausible binds, in exchange for removing every case where only a small fraction of a large box's discs happened to resolve. The common, safe case — exactly one folder failing while every other disc pairs perfectly — still binds fine under this rule.

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

Before any of this: dangling `equivalentReleaseId`/`equivalentReleaseGroupId`/`equivalentMediumPosition` (pointing at a deleted release — no FK, orphan sweep doesn't touch it) are cleared first. Tiers 1-3 only ever fill NULL, never correct a stale value. Left dangling, a stale pointer here can fail the whole repair pass — see next section.

### One box never blocks the rest

Every group binds/folds/dissolves inside its **own error boundary** — a failure is logged (folder path) and counted, pass moves to the next group.

**Why this matters:** a write error inside one group's fold/dissolve must never propagate past that
group — an unhandled error abandons the whole pass in a fixed processing order, so every group behind
the failing one silently gets nothing done, run after run, until the underlying issue is found. Two
distinct causes have hit this in the past (a `groupKey` collision when a box root is already its own
`LocalRelease` — now the "left alone" case above; a dangling FK — now cleared up front, see above).
Full incident detail: `docs/history/sync_decisions_history.md` "Box-repair error boundary".
`apply_dissolve` now writes every member inside one transaction too — no partial-box writes.

---

## 10. Two parts of sync that can fight over the same disc

Symptom: **box discs that never got a status**, run after run. Album matcher read each disc's tags (naming the *box*), bound the disc to the box; box pass then moved it to its reprinted album and marked "needs re-checking"; next run, same thing — a whole box's discs can cycle through several syncs still unscored.

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

**Ordering matters:** the missing-albums list is built per artist during the run, but boxes only split at the very end — an album whose only copy lives inside a still-unsplit box would wrongly stay listed missing if the list were never revisited. The list is swept again after box splitting to catch this.

---

## 12. "You already have these songs, inside something else"

A missing album whose songs all sit inside a compilation/box you own gets a note.

**Owning the songs ≠ owning the album** — a box's version is a different edition/master, which is exactly why MB lists it separately. Album stays listed missing, still a gap, still downloadable — only a note added.

Test: **every** track present, matched to a distinct local track, runtimes within 5s where known. Container must have *more* tracks than the album (exact-size match = it just *is* the album, the matcher's job). Releases under 3 tracks never annotated (would match by coincidence).

The 5s tolerance matters: a live-session release of the same album can share every title with the
studio version while running many seconds off per track — titles alone would call it contained; one
honest outlier refuses.

Verified against MB across a sample of the library's largest artists, with no false positives found.

---

## 13. Talking to MusicBrainz

MB allows ~1 req/s. Sync uses a single shared schedule — 1 request per 1.1s regardless of how many albums are being worked concurrently.

**Working several albums at once ≠ asking faster** — MB is slow to answer (cold request 5-30s), not stingy. A purely serial client sits idle most of the time waiting on responses and uses only a fraction of its allowed rate, stretching a full-library pass out to an impractical timeline — the rate limit was never the actual bottleneck; response latency was.

Also fixed:
- **MB cuts long replies short**, sync mistook it for complete — a release with many editions saw only the first page of results, silently missing every edition beyond it (exactly the ones a deluxe-edition search looks for).
- **"Requests remaining" is a shared global counter, not a personal allowance** — sync sped up as it dropped, i.e. went 2× rate exactly when MB was busiest.
- **Timeouts/dropped connections had no retry**, abandoned an entire artist on one blip.

Failures retried by kind: "too fast" slows down, "MB unwell" retries without slowing (slower doesn't fix their server). Typical artist (3 albums): seconds. Largest (70-140 albums): ~1h. Both normal.

---

## 14. Safety rules that override everything

- **Metadata is the truth** — folder/file names never read for artist/album/year.
- **Embedded ids believed immediately — only when files unanimously agree on them (see `docs/no_guessing.md`).** Not unanimous → `UNKNOWN` with a reason, never a plurality/majority guess and never a tracklist-score rescue (§7). Artist ids follow §5.
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
7. **A standalone album can only be recognized by recordings if MB gave every track a recording id.** Missing even one → falls back to titles/runtimes (refuses far more often). A large fraction of single-disc releases in practice are unusable as an exact target this way — the single largest reason boxes fold rather than dissolve, an MB data gap, not a decision made here.
8. **An internally-consistent wrong id is still undetectable by unanimity.** The no-guessing rule (§7, `docs/no_guessing.md`) catches a folder whose *own* tracks disagree with each other; it cannot catch a folder that unanimously, consistently carries the *wrong* id — each such folder is internally consistent, so it survives the change untouched (e.g. several differently-tagged copies of the same release all sharing one wrong id). Detecting that shape needs cross-folder comparison, out of scope here. Investigation detail: `docs/specs/spec_tidy_observations.md` §18.

---

## 16. Deploying and running an identity repair

**Order matters — backwards undoes the fix.** §5's certainty gate must be live *before* the repair runs, or the very next ordinary sync writes the wrong identity straight back.

A relink/resync running concurrently is fine, not a substitute — per §6 it can't clear an already-stuck wrong identity, only the dedicated repair does.

Order:
1. Deploy the code carrying §5's certainty gate.
2. Run `./tidy` (no `--dry-run` — same "no preview, `./backup` is the recovery path" as the box pass). Nulls wrong identities, clears piled-up discography — does **not** itself re-sync anything.
3. Normal unscoped `./sync` picks the now-empty entries back up as ordinary pending work. No need to force library-wide `--overwrite` — only touched entries need re-deriving, they re-enter the queue on their own.

## 17. Measurements — identity investigation (closed)

Moved to `docs/history/sync_decisions_history.md` §17. The gate this investigation motivated is §5;
the "CONTRADICTS" classification it used is explained inline at its one call site
(`sync::db::identity`).

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

---

## 19. To do next

Moved to `docs/history/sync_decisions_history.md` §19 - a dated investigation log and the item list it
produced (items 1-13, plus a standing "Gaps in sync and tidy" list of known non-bugs). Code comments
citing "§19 item N" refer to that file; the item numbers there are stable.

---

## 20. Stopping and restarting a NAS sync/tidy run

Two NAS quirks make the obvious commands wrong:

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
