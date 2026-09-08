# Containment ≠ ownership — rollout runbook

Companion to `docs/multidisk.md`. **Nothing in this file runs until the multidisk rollout is finished
and validated.** Section 1 is the gate; everything after it assumes that gate passed.

## 0. What this change is

`scripts/sync/src/owned.rs` used to expose `claim_owned_bundle`: whenever every track of an MB release
was found inside one bigger local release, it marked that release `COMPLETE` with
`statusReason = 'Owned as part of "<folder>"'`, linked the container's local tracks to the claimed
release's MB tracks, and rejected any queued download for it.

Two things were wrong with that.

1. **It is not ownership.** A box set's or compilation's rendition of an album is a different edition,
   usually a different master, often different edits — which is why MusicBrainz models it as a separate
   release. DMP exists to tell a collector what they actually hold. On the live library the claim
   reported **1,585 releases as owned that are not**, and removed every one of them from the MISSING
   acquisition pool so they could never be acquired.
2. **It corrupted track identity.** `link_local_tracks_to_mb` (`scripts/sync/src/db.rs`) overwrites
   unconditionally, so the claim repointed the *container's own* tracks at the claimed release's MB
   tracks — **11,178 `LocalReleaseTrack` rows** whose `mbTrackId` belongs to a release other than the
   one their `LocalRelease` is bound to. `get_tracks_with_mb_ids_for_artist` then pairs the container's
   `MUSICBRAINZ_ALBUMID` with those foreign track ids, so `sync --only-write-mb-to-files` writes a
   mismatched album/track id pair into the audio files.

The replacement is `owned::detect_containment` — a read-only detector with the same matching rule
(distinct-track title match, ±5s durations, strict superset, ≥3 tracks). A contained release stays
`MISSING`, stays counted as a gap, stays downloadable, and carries
`statusReason = 'Recordings inside "<container>"'`. No track links, no file writes, no queue rejections.
The web side reads the note via `containmentContainerTitle()` (`web/helpers/functions.ts`) and renders
a muted badge on a row that is still, visibly, a gap.

Code and tests are committed and green (Rust `cargo test`, `pnpm test:unit`). **Only the data repair
and the deploy remain**, and both are gated on multidisk.

## 1. Gate — multidisk must be done and validated first

Read `docs/multidisk.md` §12 (rollout), §13 (verification queries) and §15 (rollout status / resume
point) before touching anything here.

### Why the two cannot overlap

- The NAS runs the deployed image. The multidisk backfill is a `sync --artist-ids` run inside tmux
  `multi` on the NAS, `docker exec`-ing into container `dmp`. `./deploy` runs
  `docker compose up -d web`, which recreates that container and **kills the run**. Recoverable via
  `syncRunHash`, but it swaps the sync binary mid-run for no benefit — the cleanup below is set-based
  SQL that catches whatever exists at the moment it runs.
- `boxset::run_repair` fires **once at the tail of the whole run** (`scripts/sync/src/main.rs:2198`),
  not per artist. Until the artist loop completes, `LocalRelease.boxReleaseId`, `mediumPosition`,
  `LocalReleaseMember` and derived `equivalentReleaseId` are all legitimately **zero rows**. There is
  nothing to validate before that tail, and a restart only pushes it further away.

### The signal that the run is done

```bash
ssh -i ~/.ssh/nas Kp@192.168.1.241 "tmux ls"                                     # 'multi' still listed?
ssh -i ~/.ssh/nas Kp@192.168.1.241 "tail -n 40 /mnt/SSD/web/dmp/logs/repair-box-sets-run.log"
```

Done = the log stops advancing `[n/2047]` and the tail prints
`Box sets: N group(s) bound (F folded, D dissolved)`. If `multi` died first, resume with the exact
command in `docs/multidisk.md` §15 — `syncRunHash` skips finished artists.

### What to check before declaring multidisk good

Run `docs/multidisk.md` §13's queries, in this order:

1. **Fold** — one `LocalRelease` per plain multi-disc release, with its `LocalReleaseMember` rows.
2. **Dissolve / ABBA spot-check** (§13's last query). Expected: "The Albums" 9CD — 8 rows `COMPLETE`,
   unchanged (shape (b) must not regress); "The Complete Studio Recordings" 9CD — 9 rows rebound from
   the box to their standalone albums.
3. **Equivalences derived** for a known box (§13's second query) — `equivalentReleaseGroupId` /
   `equivalentMediumPosition` populated.
4. **Regression** — rows bound to a `mediumCount > 1` release still `MISSING_TRACKS` should trend
   toward zero, not reach it (`docs/multidisk.md` §10's known limitations are ceilings, not bugs).
5. **Scope drained** — `LocalRelease.matchStatus = 'UNKNOWN'` should have fallen back toward its
   pre-reset level. Anything still `UNKNOWN` inside the 10,230-row repair scope is an artist that never
   got processed; re-run the resume command rather than proceeding.
6. **User UI pass** — ABBA plus a couple of other box-set artists: `Box Set` pill, "disc N of M"
   subtitle, no duplicate or ghost cards. No self-verification via login.

Only then tick `docs/multidisk.md` §12 steps 2-4 and continue here. `docs/multidisk.md` §15 point 6
also says to delete `./repair-box-sets` at this point — do that in the same pass.

## 2. Pre-flight (still before deploy)

1. **Re-measure.** Every number in this file grows while the old binary runs — claims were climbing
   ~2/h and mis-pointed tracks ~16/h during observation. Treat the counts as shapes, not values:

   ```sql
   SELECT count(*) FROM "MusicBrainzRelease" WHERE "statusReason" LIKE 'Owned as part of%';

   SELECT count(*) FROM "LocalReleaseTrack" t
     JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
     JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
    WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId";
   ```

2. **Harden `scripts/sql/undo_owned_bundle_claims.sql` against box provenance — mandatory.**

   `scripts/sync/src/boxset.rs:517-527` deliberately links each dissolved disc's local tracks to **the
   box's** MB track rows while `LocalRelease.releaseId` points at the standalone equivalent. That is
   exactly the `mt."releaseId" <> lr."releaseId"` shape the undo's second statement nulls. Right now
   only the `statusReason` scoping keeps them apart, and **8 claim rows already sit on
   `mediumCount > 1` releases** — after the multidisk tail runs, some of those may also be referenced
   as boxes. Both statements need:

   ```sql
   AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr2 WHERE lr2."boxReleaseId" = <the MB release>.id)
   ```

   Without it the undo can flip a box release to `MISSING` and null the links multidisk just spent
   days deriving.

3. **Capture the artist ids to relink**, before any UPDATE, into
   `/mnt/SSD/web/dmp/logs/relink-artist-ids.txt` (== `/app/data/logs/relink-artist-ids.txt` inside the
   container — two mounts of the same directory, do not swap them):

   ```sql
   SELECT DISTINCT lra."artistId"
     FROM "LocalReleaseTrack" t
     JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
     JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
     JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
     JOIN "MusicBrainzRelease" owner ON owner.id = mt."releaseId"
    WHERE lr."releaseId" IS NOT NULL
      AND mt."releaseId" <> lr."releaseId"
      AND owner."statusReason" LIKE 'Owned as part of "%"'
      AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr2 WHERE lr2."boxReleaseId" = owner.id);
   ```

4. **`./backup`.** This phase mutates ~1.6k release rows and ~11k track rows.

## 3. Execution — strictly in this order

1. **`./deploy`.** Safe now: nothing is running against the DB. Ships the new sync binary and the web
   changes together, so the UI reads containment notes the moment the data changes.

   Deploy *before* the SQL, never after: the old binary re-mints a claim (and re-overwrites the
   `mbTrackId`s) for every artist it syncs, so an undo run against the old image is undone again by the
   next sync.

2. **Run the hardened undo.**

   ```bash
   psql "$DATABASE_URL" -f scripts/sql/undo_owned_bundle_claims.sql
   ```

   Statement 1 turns the claims back into `MISSING` gaps, rewriting the reason to the new
   `Recordings inside "<container>"` wording. Statement 2 nulls the mis-pointed `mbTrackId`s, scoped to
   those rows and excluding anything a box references.

   Note that flipping to `MISSING` also *protects* those rows: `delete_orphaned_mb_releases`
   (`scripts/sync/src/db.rs`) only deletes `status <> 'MISSING'`.

3. **Relink re-sync.** The nulled links are rewritten by the ordinary bind path
   (`scripts/sync/src/main.rs:1772`) from each release's own matched tracklist:

   ```bash
   ssh -i ~/.ssh/nas Kp@192.168.1.241
   tmux new-session -d -s relink \
     'sudo docker exec dmp sync --artist-ids /app/data/logs/relink-artist-ids.txt \
        2>&1 | tee -a /mnt/SSD/web/dmp/logs/relink-run.log'
   ```

   MB-rate-limited (~1.1s/request floor), so expect hours. Resumable via `syncRunHash` like any other
   sync run. `tee`'s target is a **host** path; `--artist-ids` takes the **container** path.

## 4. Verification

```sql
-- 0 expected: nothing still claimed as owned
SELECT count(*) FROM "MusicBrainzRelease" WHERE "statusReason" LIKE 'Owned as part of%';

-- ~1.6k expected: contained releases are now honest gaps carrying the note
SELECT count(*) FROM "MusicBrainzRelease"
 WHERE status = 'MISSING' AND "statusReason" LIKE 'Recordings inside "%"';

-- multidisk output must be identical to the Phase 1 numbers - the undo must not have touched it
SELECT (SELECT count(*) FROM "LocalRelease" WHERE "boxReleaseId" IS NOT NULL) AS dissolved_discs,
       (SELECT count(*) FROM "LocalReleaseMember")                            AS fold_members,
       (SELECT count(*) FROM "MusicBrainzReleaseMedium"
         WHERE "equivalentReleaseId" IS NOT NULL)                             AS equivalences;

-- remaining cross-release links should be dissolve-authored only, never a containment note
SELECT owner."statusReason", count(*)
  FROM "LocalReleaseTrack" t
  JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
  JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
  JOIN "MusicBrainzRelease" owner ON owner.id = mt."releaseId"
 WHERE lr."releaseId" IS NOT NULL AND mt."releaseId" <> lr."releaseId"
 GROUP BY 1 ORDER BY 2 DESC;
```

Then a UI pass on an artist known to carry notes — Nina Simone is the case that started this
(`Gifted & Black` inside `Ne me quitte pas`). Expected: greyed gap row, muted `Recordings inside "…"`
badge that links across to the container, working Download action. **Not** an owned release.

## 5. Expected side effect

The undo returns ~1,600 releases to the `MISSING` pool that `web/server/utils/autoDownload.ts` picks
from. With monitoring on, the trickle worker will start acquiring standalone editions — intended, but
check `Settings → Downloads` first if the queue should not grow by that much at once.

## 6. Rollback

The undo is two `UPDATE`s in one transaction; there are no deletes. If it has to be reversed, restore
from the `./backup` taken in §2.4 — reversing statement 2 by hand is not possible (the old values were
wrong by construction and are not recorded anywhere).

The code change is independently revertable: `owned::detect_containment` writes nothing, so reverting
the binary alone simply stops the notes from being refreshed.
