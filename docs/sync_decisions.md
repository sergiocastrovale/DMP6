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
worth re-running occasionally — the original cause of the bad identities has not been traced, so new
ones may still appear.

---

## 5. Matching an album to MusicBrainz

Four attempts, in order. **The file tags always win over searching.**

1. **The album id in the files.** Believed directly, no second-guessing.
2. **The album-group id in the files** — browse its editions and pick one (see §6).
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

## 6. Deciding whether an album is complete

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
| **Unknown** | "Needs re-checking" — a temporary state, see §8 |

**"Missing tracks" is often not a fault.** Real examples from this library: your file is the 2009
remaster where MusicBrainz lists a 2015 remix; your file is titled "Jumping Jack Flash" where
MusicBrainz says "Jumpin' Jack Flash"; your tracks are Spanish-language versions. These are tagging
differences, not sync errors.

---

## 7. Box sets and multi-disc albums

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

## 8. Two parts of sync that used to fight

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

## 9. Albums you are missing

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

## 10. "You already have these songs, inside something else"

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

## 11. Talking to MusicBrainz

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

## 12. Safety rules that override everything

- **Metadata is the truth.** Folder and file names are never read for artist, album or year.
- **Ids embedded in your files are believed immediately** — no second-guessing.
- **Nothing is deleted to make a match fit.** Ambiguity produces "unmatched", never a deletion.
- **A network failure is never evidence.** It defers; it never concludes an album does not exist.
- **Sync repairs and re-runs are safe to repeat.** Running it twice produces the same result as once.

---

## 13. Known limits — real ceilings, not bugs

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

## 14. Where to start digging

| Symptom | Section |
|---|---|
| Album on the wrong artist's page | §2, §3 |
| Artist page under the wrong name, or duplicated | §4 |
| Album shows unmatched but obviously exists | §5 |
| Wrong pressing / wrong track list | §5 |
| "Missing tracks" on an album that looks complete | §6 |
| Box set shown as one lump, or as scattered discs | §7 |
| Box discs stuck on "unknown" across runs | §8 |
| Album listed missing that you own | §9, §7 |
| "Songs inside another release" note looks wrong | §10 |
| Sync too slow, or MusicBrainz errors | §11 |

Useful commands: `./sync --repair-artist-identities --dry-run`,
`./sync --only "Artist" --exact --verbose`, `./audit`.
