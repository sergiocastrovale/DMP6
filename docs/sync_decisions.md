# How sync decides things

**Start here when something in the library looks wrong.** This is the full list of judgement calls
`./sync` makes: every ambiguity, every tie-break, every "we could have gone either way and here is
which way we went, and why". Written to be read, not to be a developer reference.

A rule of thumb that explains most of the document: **sync would rather leave something unmatched
than match it wrongly.** Almost every decision below resolves a tie by refusing rather than guessing.
If an album looks unmatched when it obviously should not be, the cause is usually one of these
refusals, not a crash.

---

## 1. What counts as an album you own

A **folder is one album.** Not a tag, not a MusicBrainz id — the physical folder. Two copies of the
same album in two folders are two entries, on purpose, and the app groups them on screen.

Deliberately *not* used to group: the MusicBrainz ids inside the files. A compilation's files each
carry the id of the album they were originally lifted from, so grouping by that would shatter one
compilation into dozens of fragments.

Loose files with no folder fall back to being grouped by album title + year + artist.

**Album title and year come from the file tags** (whichever value is most common across the folder),
never from the folder name. Once MusicBrainz matches the album, its title wins instead.

---

## 2. Who owns an album vs who merely appears on it

- **Owner** = the `albumArtist` tag. This is the artist whose page the album appears on.
- If `albumArtist` says "Various Artists" (or is empty), the track's own `artist` tag decides instead.
- **Appears on** = anyone credited on a track but not an owner. They get a credit, not the album.

**Compound names are split by meaning, not punctuation:**

- `A with B`, `A feat. B` → **A owns it**, B is credited.
- `A & B`, `A, B` → **both own it**.

**More than 4 co-billed names means it is a personnel list, not a band.** A real example had 44 session
musicians on one Sinatra album; treating those as co-owners would have put that album on 44 different
artist pages. So the first name owns it and the rest become credits.

---

## 3. Turning a name into a real artist

This is the single most damage-prone step, because splitting a name wrongly destroys a real band.
Measured on real data: of 722 distinct names containing the word "with", **721 were being split
wrongly** — including four bands that actually own albums here ("Nurse With Wound", "MAN WITH A
MISSION").

**So the rule is: a separator is never proof of a split.** Sync asks MusicBrainz whether the whole
string is a real artist *first*, and only considers splitting if it definitively is not.

Order of attempts, cheapest first — most names never reach the internet:

1. Ids embedded in the file tags — authoritative, free, believed immediately.
2. A name already looked up before (cached).
3. The **whole string** as one artist.
4. Splitting into pieces, with every proposed grouping checked against MusicBrainz the same way.
5. Last resort: accept the pieces unverified, minus obvious role-words.

**Things treated as separators:** `featuring`, `feat.`, `ft.`, `with`, `vs`, `and`, `&`, `x`, `;`,
`,`, `/`, `+`, `·`, `•`, `♦`, `\`, `|`.

**Things deliberately *not* separators:** a bare `/` and a bare `+` without spaces around them — that
is what keeps **AC/DC** and **Florence + the Machine** intact. A comma between two digits is part of a
number, which is what keeps **10,000 Maniacs** intact.

**A network failure never causes a split.** If MusicBrainz cannot be reached, the name is left alone
and retried later, because a momentary blip must not permanently shred a band name.

Names like "Various Artists", "[unknown]", "[no artist]" are recognised as placeholders and skipped
entirely — they are not artists.

---

## 4. When two artist entries are the same artist

Two entries are the same artist **only if both names resolve to the same MusicBrainz identity.**
Nothing else counts — not similar spelling, not one name containing the other.

When they are the same, the entry that **owns albums** becomes the real one and the other becomes its
alias. If both own albums, the one with more wins; ties break consistently so repeated runs give the
same answer.

**This got it wrong before and it was ugly.** The old rule accepted *any* other entry holding the same
identity, with no check that it owned anything and no consistent ordering — so a near-empty entry
could end up in front of the entry holding an entire discography. Bob Dylan's 72 albums sat under
"Dylan"; Erroll Garner's 76 sat under "Wardell Gray Quintet". 33 artists were affected.

A related fault: an almost-empty entry can end up **holding another artist's MusicBrainz identity**,
which is what drags albums onto the wrong name. When sync repairs one of these, the wrong entry gives
the identity up.

`./sync --repair-artist-identities` sweeps all of these in one go (`--dry-run` to preview). It is
worth re-running occasionally.

**Traced (2026-09-10).** Erroll Garner's 76 albums sat under "Wardell Gray Quintet" because that entry's
files carry an embedded MusicBrainz id — but it is the wrong one, Garner's, not the Quintet's own. One
mistagged file:

```
Wardell Gray/Album/1990 - The Chase/11. Blue Lou.mp3
  artist tag = "Wardell Gray Quintet"      (right)
  embedded id = 75bd5186…                  (Erroll Garner — wrong)
```

Sync treats an embedded id as definitive and writes it straight onto the entry, permanently — nothing
ever double-checks that the id actually names the artist the tag says it does. And once written it
sticks: the write only ever fills an *empty* slot, so no later, correct answer can overwrite it, and a
name already seen once is never looked at again on a later run.

A second, wider version of the same gap: sync's own search step deliberately tolerates loose matches
(so "Radiohead" still finds "radiohead" or "Radio Head") — but that tolerance was also used to *accept an
identity*, not just to find releases. "Wardell Gray Sextet" and "Wardell Gray" score close enough to
count as the same artist under that looser rule, so the Sextet entry also ended up holding the wrong
(person, not ensemble) identity. Measured library-wide: **1,269 entries hold an identity that
contradicts what their own name independently resolves to**, in **149 entries pairs/groups sharing one
identity that should not be shared**, traceable through **15,493 mistagged embedded-id pairs** in the
files themselves.

The fix (in progress): an identity may only be **claimed** — written to an entry — when it is certain:
either the embedded id and an independent name lookup agree, or the name itself matches exactly (not
approximately). A loose/approximate match may still be used to find and sync an artist's releases, but
never to claim who that artist *is*. Where certainty is not there, the entry is correctly left unmatched
rather than guessed at — consistent with this whole document's opening rule of thumb: refuse rather
than guess. See §5 below for exactly which steps may claim an identity, and §6 for why fixing this in
code does not, by itself, undo the damage already written.

---

## 5. Matching phases — what each step may and may not decide

Turning a raw name into a MusicBrainz identity happens in ordered steps, cheapest and most certain
first. Each step below either **finds** an artist's releases or **claims** their identity — those are
different questions, and conflating them is exactly the fault §4 traces.

1. **An id embedded in the files.** Normally definitive and believed directly (§14). The one exception:
   if an independent, exact lookup of the artist's own name disagrees with the embedded id, the embedded
   id is no longer trusted, and the independent, agreeing answer is used instead.
2. **The artist's name, looked up exactly.** Certain. May claim.
3. **The artist's name, searched loosely** (tolerant of spelling, spacing, word order). This step exists
   to *find* releases for an artist already believed in, not to decide who the artist is — a loose match
   here is used to sync releases, never to write a new identity onto an entry.
4. **Other names found on the same tracks** (a compound tag's other half, a track's own artist field).
   Only ever evidence about *that other name*, never about the entry being resolved — this is the step
   that let Erroll Garner's identity leak onto the Quintet entry, since nothing checked the result
   actually named the Quintet.

**The rule this whole section boils down to: only an exact, independently-verified match may claim an
identity.** A tolerant match is allowed to help find and sync an artist's own releases, and nothing more.

---

## 6. Repair vs. re-sync — a wrong identity does not fix itself

**A normal sync run, even a full `--overwrite`, cannot undo a wrongly-claimed identity — it can only
replace one wrong claim with another (or leave the first one exactly as it was).** This is
counter-intuitive enough to state plainly: re-running sync is not the fix for §4's damage.

Why: once an entry already holds an id, an ordinary sync run trusts it and never re-examines it — the
whole point of not re-verifying embedded/stored ids (§14) is to avoid re-asking MusicBrainz the same
question forever. A `--overwrite` run does re-ask, but if the honest answer this time is "not certain
enough" (§5), the run correctly leaves the entry unmatched for *new* work — it does not go back and
erase the *old* wrong answer sitting in the identity field, because clearing a value nobody asked it to
touch is a different action from finding a new one.

So undoing already-wrongly-claimed identities is a **repair**, not a **sync**: a dedicated pass that
looks for entries whose stored identity contradicts an independent, confident answer, clears the wrong
one, and lets the entry re-enter the normal queue to be found again — correctly, or not at all.
`./sync --repair-artist-identities` is that pass. Running sync harder or more often is not a substitute
for it.

Three sub-passes, run in this order every time the flag is used:

- **Pass A** (`repair_all_empty_primaries`) — a duplicate/alias pair linked by `primaryArtistId` where
  the empty side's stored id contradicts its own name.
- **Pass B** (`repair_contradicted_identities`) — any entry, linked or not, whose stored id
  `MbArtistLookup` confidently contradicts (an exact-name row with a *different, non-null* id). A cached
  miss or no cache entry at all is left alone — neither is evidence against the stored id, only the
  absence of evidence for it.
- **Pass C** (`repair_shared_identities`) — two or more unrelated entries holding the exact same id.
  The id is kept only where exactly one member is independently confirmed; if none is confirmed, every
  member gives it up rather than guess which one is real.

Both B and C also delete the entry's derived `MusicBrainzReleaseArtist` rows, so the wrong discography
disappears immediately instead of lingering until the next sync.

---

## 7. Matching an album to MusicBrainz

Four attempts, in order. **The file tags always win over searching.**

1. **The album id in the files.** Believed directly, no second-guessing.
2. **The album-group id in the files** — browse its editions and pick one (see §8).
3. **Search by album title + artist**, and *only* when the files carry no usable id at all. A search
   hit must score at least 85, have a similar title, and be an allowed type.
4. If the files point at something the library refuses to bind (a bootleg, say), search is given one
   chance to find a legitimate edition instead. Before this existed, such an album was simply stuck.

If none of that produces a confident answer, the album is left **unmatched** rather than guessed at.

### Which albums are allowed to match at all

The library is album-oriented:

- **Allowed:** Album and EP. Compilations, live albums, remixes and soundtracks ride on those and pass.
  Remasters and deluxe editions are not separate types in MusicBrainz and pass automatically.
- **Rejected:** audiobooks, audio drama, spoken word, interviews, field recordings, demos.
- **Must be Official** — no bootlegs. An album with no status listed is treated as official.
- **Singles are never searched for or invented** — but a single whose id is *in your files* does bind,
  because you demonstrably own that disc. MusicBrainz files plenty of 4-track CDs as "singles";
  Radiohead's "Creep" sat unmatched for years because of this.

### Which pressing gets picked

An album exists in many editions. Sync prefers the one whose track count exactly matches your folder.
If several match, it breaks the tie by: **same year as your files → CD format → earliest release
date.** If none match and there are several candidates, it refuses and leaves the album unmatched,
because binding a random pressing produces permanently wrong track lists.

One exception: if your folder has *more* tracks than the matched edition, sync looks for a deluxe
edition with the exact count. Fewer tracks is treated as genuine incompleteness, not a wrong edition.

---

## 8. Deciding whether an album is complete

Sync matches your tracks to the official track list **by title, not by position** — track order
differs between pressings constantly.

Titles match if they are identical ignoring case, punctuation and accents; or if one contains the
other (which absorbs "remastered", "live", "bonus" style suffixes); or if they share at least 80% of
their meaningful words. Words like "the", "and", "of" are ignored when scoring, so two unrelated songs
cannot match just by sharing them.

**Identical titles are claimed before a loose match is even tried.** A bonus disc full of alternate
takes shares one base title across many tracks ("Song", "Song (remake)", "Song (take 3)", "Song (take
4)"...). Matching loosely in one pass let an early plain-titled track steal a "(take 3)" file before the
real exact pairing got a turn, leaving the genuine "(take 3)" track with nothing to pair to — a false
"missing tracks" verdict on a disc that was actually complete. Found live on Elvis Presley's "Elvis Back
in Nashville" (82 tracks, one such family). Fixed by claiming every identical title first, library-wide,
and only letting a loose match compete for what's left over.

The result:

| Status | Meaning |
|---|---|
| **Complete** | Every official track present, nothing extra |
| **Missing tracks** | Some official tracks not found in your files |
| **Extra tracks** | You have more tracks than the edition lists |
| **Unmatched** | No confident match — deliberately left alone |
| **Unknown** | "Needs re-checking" — a temporary state, see §10 |

**"Missing tracks" is often not a fault.** Real examples from this library: your file is the 2009
remaster where MusicBrainz lists a 2015 remix; your file is titled "Jumping Jack Flash" where
MusicBrainz says "Jumpin' Jack Flash"; your tracks are Spanish-language versions. These are tagging
differences, not sync errors.

---

## 9. Box sets and multi-disc albums

MusicBrainz has **no concept of a box set.** A box is one release with several discs. There is also no
link saying "disc 3 of this box is that standalone album" — the only thing shared is the *recording*
of each song. Everything below is sync reconstructing a relationship MusicBrainz does not record.

### Finding a box

Folders sitting side by side inside a parent folder are treated as candidate discs of one thing.

### Matching folders to discs

Every folder must match exactly one disc, and every match must be unambiguous — **otherwise the whole
group is refused.** A partly-ripped box is fine (missing discs are just missing); an *ambiguous* disc
is not.

Matching a folder to a disc happens in three passes, strictest first, so a loose match can never steal
a track a strict match had a claim on:

1. **Identical titles, running times within 5 seconds.**
2. **Identical titles, running times within 15 seconds** — rips and masterings shift a track by a few
   seconds.
3. **One title containing the other**, and only when exactly one candidate fits. Ambiguity is refused.

**Why the order matters so much:** ABBA's box holds four language versions of "Ring Ring" whose running
times are all within seconds of each other. A single loose pass would pair whichever came first.
Claiming the exact titles up front removes the risk entirely.

**Both loosenings were paid for in real damage.** ABBA's nine-disc "Complete Studio Recordings" — a
perfect 9-of-9 rip — was rejected outright twice: once because one song was tagged "Ring Ring (English
version)" where MusicBrainz says "Ring Ring", and again because one track was 6 seconds longer than
listed. One song out of 133 rejected the entire box.

### Then: fold, or dissolve?

Sync works out which discs of the box are also standalone albums you could own separately.

- **2 or more discs recognised → dissolve.** Each disc is shown as the album it reprints, remembering
  which box it came from. A 9-disc box becomes 9 album entries, not one lump.
- **0 or 1 recognised → fold.** The whole box becomes a single entry.

Folding when almost nothing is recognisable is deliberate, not a failure. Many boxes ("complete
sessions" reissues) have discs that do not line up with any original album at all — one CD can span
material from two different records. One tidy entry is the right answer there.

Discs with no standalone equivalent (a rarities disc, a bonus disc) stay attached to the box.

### Recognising a disc as a standalone album

Three methods, each tried only on what the previous left unresolved:

1. **Identical set of recordings.** Exact and certain — recordings are unique ids, so there is no
   coincidence risk at any track count. Deliberately **no minimum track count**: requiring one made
   every "singles box" permanently unrecognisable.
2. **Same track titles and lengths, in the same order** — for older data lacking recording ids.
3. **The disc contains an entire album plus extras** — for when the box uses a bonus-track version that
   MusicBrainz never catalogued separately. Only runs on discs that have a name to search with, and if
   two albums both fit, it gives up rather than choose.

---

## 10. Two parts of sync that used to fight

Worth knowing, because the symptom was baffling: **box discs that never got a status**, run after run.

The album matcher read each disc's own tags, which name the *box*, and bound the disc to the box. The
box pass then moved it to the album it reprints and marked it "needs re-checking". Next run, the same
thing. ABBA's box came out of three consecutive syncs with nine unscored discs.

The rule now: **once the box pass has placed a disc, that decision stands.** The album matcher scores
the disc where the box pass put it instead of re-reading the tags, the deluxe-edition search is skipped
for those discs (a box disc legitimately has more tracks than the standalone album, so that search
always "succeeded" and restarted the fight), and the box pass only writes when something actually
changed.

If box discs ever show "unknown" again across repeated syncs, this is the first place to look.

---

## 11. Albums you are missing

For each artist, sync lists the official albums you do not have. Filtered the same way as §5, plus a
check that the album group actually has an official release — without that, bootleg live recordings
flood the list, since they look identical to legitimate live albums by type alone.

An album counts as **owned** if any local folder is bound to it, **or** if it is a dissolved box disc,
**or** every one of its discs is accounted for. Missing that last part would make every dissolved box
look absent and offer it for re-download.

Ordering used to matter here and caused a real fault: the missing list was built per artist during the
run, but boxes were only split at the very end, so an album whose only copy lives inside a box could
stay listed as missing. The list is now swept again after boxes are split.

---

## 12. "You already have these songs, inside something else"

A missing album whose songs all sit inside a compilation or box you own gets a note saying where they
are.

**Owning the songs is not owning the album.** A box set's version is a different edition, usually a
different master, often different takes — which is exactly why MusicBrainz lists it separately. So the
album stays listed as missing, still counts as a gap, and can still be downloaded. Only a note is
added.

The test is strict: **every** track must be present, each matched to a distinct local track, with
running times within 5 seconds where both are known. The container must have *more* tracks than the
album (an exact-size match means it simply *is* that album, which is the matcher's job, not this).
Releases under 3 tracks are never annotated — they would match by coincidence inside anything.

The 5-second tolerance is doing real work: "In Rainbows: From the Basement" is the same ten songs as
"In Rainbows", played live. Titles alone called it contained. The live takes run 1–33 seconds off the
studio ones, and since every track must match, one honest outlier is enough to refuse.

Verified against MusicBrainz for the four largest artists in the library: **108 of 108 notes correct.**

---

## 13. Talking to MusicBrainz

MusicBrainz allows about one request per second. Sync honours that with a single shared schedule — no
matter how many albums are being processed at once, requests leave one per 1.1 seconds.

**Working several albums at once does not mean asking faster.** It exists because MusicBrainz is slow
to answer, not because it is stingy: a cold request takes 5–30 seconds, so asking one at a time left
the connection idle roughly 85% of the time and used about a sixth of the allowance. A full library
pass was on track for **~99 days**, and the assumed cause (the rate limit) was wrong.

Also fixed along the way:

- **MusicBrainz cuts long replies short**, and sync mistook a short reply for a complete one. For "OK
  Computer" it saw 31 of 39 editions — the 8 it never saw were every deluxe edition, which is exactly
  what the deluxe-edition search looks for.
- **The "requests remaining" number MusicBrainz sends is a shared global counter**, not a personal
  allowance. Sync treated it as its own and *sped up* when the number dropped — that is, went twice
  the allowed rate precisely when MusicBrainz was busiest.
- **Timeouts and dropped connections had no retry at all** and abandoned an entire artist on one blip.

Failures are retried and separated by kind: "you are going too fast" slows the pace down, "MusicBrainz
is unwell" retries without slowing down, since going slower does not fix their server.

Speed expectations: a typical artist owns 3 albums and takes seconds. The largest here own 70–140 and
take about an hour each. Both are normal.

---

## 14. Safety rules that override everything

- **Metadata is the truth.** Folder and file names are never read for artist, album or year.
- **Ids embedded in your files are believed immediately** — no second-guessing.
- **Nothing is deleted to make a match fit.** Ambiguity produces "unmatched", never a deletion.
- **A network failure is never evidence.** It defers; it never concludes an album does not exist.
- **Sync repairs and re-runs are safe to repeat.** Running it twice produces the same result as once.

---

## 15. Known limits — real ceilings, not bugs

These come from what MusicBrainz does and does not record. Changing them means guessing.

1. A box disc under 3 tracks cannot be identified as a standalone release and stays an unnamed extra.
2. A single disc holding two complete albums can only be linked to one of them.
3. A box where nothing it contains was ever released separately correctly becomes one entry.
4. Boxes with no disc names at all (chronological "complete sessions" sets) cannot have their discs
   identified. This is the most common box shape — expect it often.
5. A remaster that re-splits an album across a different number of discs than any standalone edition
   cannot be lined up.
6. A box-exclusive "lost album" and a plain rarities disc look identical in MusicBrainz's data.

---

## 16. Deploying and running an identity repair

**Order matters, and getting it backwards undoes the fix.** The code change (§5's certainty gate) has to
be live *before* the repair runs — repairing first, on the old code, means the very next ordinary sync
writes the wrong identity straight back, because nothing yet stops it from doing so.

**A relink or resync running at the same time is not a substitute for the repair**, and does not need to
be stopped for it. A resync — even a full "re-check everything" pass — only ever trusts or replaces an
entry's identity; per §6 it cannot clear a wrong one that already stuck. Nulling wrong identities and
letting their entries fall back into the ordinary queue is only what the dedicated repair does. So an
unrelated maintenance run and the identity repair don't conflict — they touch different columns for
different reasons — but doing the repair first, before the fix is deployed, would immediately be undone
by the next ordinary sync of an affected artist.

Order:

1. Deploy the code carrying §5's certainty gate.
2. Run `./sync --repair-artist-identities --dry-run`, read the plan.
3. Run it for real. This nulls the wrong identities and clears the discography that had piled up under
   them; it does **not** itself re-sync anything.
4. A normal, unscoped `./sync` — no special flags — picks the now-empty entries back up as ordinary
   pending work and re-derives each one properly, or leaves it honestly unmatched. There is no need to
   force a library-wide `--overwrite` for this: only the entries the repair actually touched need
   re-deriving, and they already re-enter the queue on their own.

## 17. Measurements taken during the 2026-09-10 identity investigation

Baseline, for comparing against after the fix and repair land — re-run the same query, expect the
"contradicts" row to fall toward zero and the "confirms" row to stay put:

```sql
SELECT CASE WHEN l.name IS NULL THEN 'unknown'
            WHEN l.mbid IS NULL THEN 'unresolvable'
            WHEN l.mbid = a."musicbrainzId" THEN 'CONFIRMS'
            ELSE 'CONTRADICTS' END AS verdict,
       count(*), sum((SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId"=a.id))
  FROM "Artist" a LEFT JOIN "MbArtistLookup" l ON l.name = a.name
 WHERE a."musicbrainzId" IS NOT NULL AND a."musicbrainzId" <> '' GROUP BY 1;
```

| Verdict | Entries | Albums |
|---|---|---|
| Confirms its own identity | 37,382 | 151,881 |
| **Contradicts its own identity** | **1,269** | **1,646** |
| No independent answer on record | 1,929 | 1,316 |
| Independent answer says unresolvable | 104 | 408 |

Also measured: **149** groups of entries sharing one identity that should not be shared, and **15,493**
tracks whose embedded name/id pair disagrees with the independent answer for that same name.

**Outcome, after §5's gate shipped and `./sync --repair-artist-identities` ran for real (same day):**

| Verdict | Entries | Albums |
|---|---|---|
| Confirms its own identity | 37,394 | 152,124 |
| **Contradicts its own identity** | **0** | **0** |
| No independent answer on record | 1,908 | 1,314 |
| Independent answer says unresolvable | 101 | 406 |

Confirms held (and grew slightly — the containment relink was running concurrently), contradicts fell to
zero. Pass B cleared 1,268 identities; Pass C resolved 17 shared-id groups (of the original 149, most had
already collapsed to size 1 once Pass B ran — B runs first in the same invocation). **11 groups remain**:
genuine collisions where more than one member's own name was independently confirmed for the same id —
Pass C deliberately leaves these for a human rather than pick one, per the "no wild guesses" rule (§5/§6).
A second, immediate re-run of the repair found 0/0/0 to do, confirming it does not re-touch what it
already fixed.

## 18. Where to start digging

| Symptom | Section |
|---|---|
| Album on the wrong artist's page | §2, §3 |
| Artist page under the wrong name, or duplicated | §4 |
| One artist's albums showing on a *different, unrelated* artist's page | §4, §5, §6 |
| Album shows unmatched but obviously exists | §7 |
| Wrong pressing / wrong track list | §7 |
| "Missing tracks" on an album that looks complete | §8 |
| Box set shown as one lump, or as scattered discs | §9 |
| Box discs stuck on "unknown" across runs | §10 |
| Album listed missing that you own | §11, §9 |
| "Songs inside another release" note looks wrong | §12 |
| Sync too slow, or MusicBrainz errors | §13 |
| Ran `--repair-artist-identities` but the wrong albums are still there | §6 — a repair clears the id, it does not re-sync the artist; that happens on the next normal run |

Useful commands: `./sync --repair-artist-identities --dry-run`,
`./sync --only "Artist" --exact --verbose`, `./audit`.
