# Scripts: sync

Queries pending artists (`lastIndexedAt > lastSyncedAt`, or never synced — but only artists **with** a `lastIndexedAt`: NULL is never selected, `docs/sync_decisions.md` §19 item 13) and syncs each against MusicBrainz. Run-hash resumable — interrupted runs skip already-processed artists. Reads DB, calls MB API. Writes found MB IDs back to file tags (preserving mtime) and embeds cover art.

Artists holding only track credits ("appears on", owning no release) are deliberately not synced — excluded by `EXISTS(LocalReleaseArtist)`, not a stored flag. See `docs/scripts/index.md` Artist Resolution.

## TL;DR

1. Load config, connect DB, acquire process lock.
2. Select artists: `--release` (single), `--overwrite` (all), or default (`lastIndexedAt > lastSyncedAt` **or** any `LocalRelease` at `matchStatus=UNKNOWN` — e.g. left by a box dissolve, `docs/sync_decisions.md` §7). Skip artists already done this run (`syncHash`).
3. **Per artist:** skip special names (Various Artists, [unknown]) → find on MB (existing id or search, skip MB-id duplicates) → persist MB id + country (from MB area ISO 3166-1), fetch details (genres/tags/URLs), upsert → download artist image if missing (Wikidata → Wikipedia → Fanart.tv → local/S3) → fetch release groups.
4. **No-guessing gate first** (`docs/no_guessing.md`): a folder's album tag and embedded MB id(s) must be **unanimous** across its tracks (`common::consensus::evaluate`) — never a plurality/majority vote. Not unanimous → `UNKNOWN` with a human-readable `statusReason`, no MB call this run. Exempt: a dissolved box disc (placement comes from the box pass) and a folded multi-disc survivor. **Per release:** skip already-synced (has `releaseId`) unless `--overwrite`/`UNKNOWN` → match Tier 1 (`MUSICBRAINZ_ALBUMID`, the verdict's unanimous id) → Tier 2 (`MUSICBRAINZ_RELEASEGROUPID`, the verdict's unanimous group id — also the Tier 1 404 fallback) → Tier 3 (title+artist search, only when the folder carries no usable id at all) → else `UNMATCHED`. No plurality, no COMPLETE-rescue of a scattered id, no deluxe-sibling upgrade search — a folder unanimity already let through binds directly; extra local tracks beyond the matched edition score `EXTRA_TRACKS` rather than triggering a bigger-sibling search. Allow-list: Official Album/EP only (Single binds only when files' own ids point at it; a rejected candidate gets one search-tier retry). Compare track counts → `COMPLETE`/`EXTRA_TRACKS`/`MISSING_TRACKS`/`INCOMPLETE`. Ambiguous (multiple editions, no exact count match) → `UNMATCHED`. Upsert MB release, link tracks; unmatching clears track links.
5. **Cover art** (batched per artist): Cover Art Archive → embed → re-extract 200x200 thumbnail → `img/releases/`.
6. **Cleanup:** update artist sync stats + statistics, delete orphan MB releases, release lock.

## Build

```bash
cd scripts && cargo build --release -p sync
```

## Usage

```bash
./sync                           # all pending
./sync --only "radiohead"        # prefix match
./sync --only "Air" --exact      # exact (won't catch "Airbag")
./sync --from "A" --to "M"       # letter range
./sync --release "clxxxxxxx"     # re-sync one release by LocalRelease id
./sync --overwrite               # re-sync all, ignores lastSyncedAt
./sync --skip-artist-img
./sync --skip-release-img
./sync --verbose                 # show skipped MB releases
./sync --catalogue-gaps          # fast pass: MISSING entries only, few API calls/artist
./sync --catalogue-gaps --only x
./sync --catalogue-gaps --overwrite  # re-fetch all MISSING from scratch
./sync --skip-mb-tags            # don't write MB IDs back to tags
./sync --only-write-mb-to-files [--only x]  # backfill DB-known MB IDs into tags, no API calls
./sync --web                     # PROGRESS:{json} for web terminal
./sync --release "clxxx" --artist-hint "clyyy"  # prefer this artist when release has several main artists
```

Sync = per-artist matching only. Library-wide repair (box-set fold/dissolve, identity repair, score recompute, orphan cleanup) lives in `./tidy`, which every caller chains after `./sync` (`docs/scripts/tidy.md`). Sync never calls tidy. `--release` can't combine with `--from`/`--to`/`--only`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | - | Start letter filter |
| `--to` / `-t` | String | - | End letter filter |
| `--only` / `-o` | String | - | Artist filter (`;`-separated) |
| `--exact` | bool | false | Exact match for `--only` |
| `--release` | String | - | Re-sync one release by LocalRelease id |
| `--overwrite` | bool | false | Re-sync all matched, not just pending |
| `--skip-artist-img` | bool | false | Skip artist image download |
| `--skip-release-img` | bool | false | Skip release cover download |
| `--catalogue-gaps` | bool | false | Fast pass: MISSING entries only |
| `--skip-mb-tags` | bool | false | Skip writing found MB IDs to tags |
| `--only-write-mb-to-files` | bool | false | Backfill DB-known MB IDs into tags, no API calls, then exit |
| `--verbose` | bool | false | Log skipped/already-synced releases |
| `--concurrency` | usize | 6 | Artists synced at once — not a rate knob, see Rate Limiting |
| `--web` | bool | false | PROGRESS:{json} for web terminal |
| `--artist-ids` | String | - | Read ids from file (one/line, used by refresh) |
| `--artist-hint` | String | - | With `--release`: prefer this Artist id when release has several main artists |

## Output Modes

Without `--web`: colored console progress + rate-limit countdown. With `--web`: `PROGRESS:{json}` lines (web UI appends `--web` automatically).

## Per-Artist Flow

1. **Find MB match** — 5-step algorithm (below).
2. **Fetch** detail: URLs, genres (top 5 by count), tags, country (`area.iso-3166-1-codes`).
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize 500px — spawned, not awaited (max 4 in flight; none of those hosts is MB, so no MB rate budget consumed — awaiting inline left the limiter idle for hours across ~20k artists missing an image). Results reported by artist name as they land, may appear mid-later-artist. Ctrl-C abandons in-flight downloads, gated on artist having no image → next run picks it up.
4. **Fetch** release groups (paginated).
5. **Per local release** — 3-tier matching (below): Tier 1 direct lookup by `MUSICBRAINZ_ALBUMID` consensus; Tier 2 release-group browse by `MUSICBRAINZ_RELEASEGROUPID` consensus (or Tier-1 404 fallback); Tier 3 search fallback (no usable id consensus, or retry after allow-list rejection). Every candidate passes the allow-list; no consensus + no confident search → `Unmatched`.
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match.
7. **Write MB IDs** to file tags (`MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_RELEASETRACKID`=release-track id, `MUSICBRAINZ_TRACKID`=recording id; ID3 uses Picard's TXXX + `UFID:http://musicbrainz.org` for recording) — only fills absent tags, never overwrites unless `--overwrite`. Preserves mtime. Skipped with `--skip-mb-tags`. Creates a tag block if none exists.
8. **Cover art** — Cover Art Archive (release-level then release-group fallback), embed, re-extract 200x200 thumbnail (same pipeline as index, `common/src/images.rs`).
9. **Set `lastSyncedAt`**, persist country, compute completeness.
10. **Stamp run hash** for resumability.

Duplicate detection: tracks processed MB ids across the run, skips artists resolving to an already-processed MB artist.

## --catalogue-gaps Behaviour

Fast path for populating MISSING entries without a full sync. Requires artist already has `musicbrainzId`.

Scope: name filtering (`--only`/`--from`/`--to`/`--exact`), or an explicit `artist_ids` param on `fill_catalogue_gaps` used only by `./add` — scopes to the single artist id it just created (no name-match cross-contamination, no `;` handling needed). `./sync`'s own CLI always passes `None`.

**Per artist (few API calls):** use existing `musicbrainzId` (no search) → fetch release groups → fetch Official Album/EP releases (paginated, ~1-4 calls) to learn which groups have an Official release ("Official-only gaps" below) → read genres from DB (no call) → `--overwrite` deletes stale MISSING first, else skip groups with existing MISSING entries → create MISSING entries for uncovered official groups + link genres.

**Skips entirely:** artist search, detail fetch, URL upsert, image, local release matching, cover art.

**Performance:** 1 release-group browse + artist catalogue browse (1 page typical, ~11 for a Radiohead-sized artist — `inc=recordings` pages are size-capped). Both paths share one catalogue, so containment costs no extra calls here either.

Cannot combine with `--release`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`/`--web`/`--verbose`.

## --only-write-mb-to-files Behaviour

Writes DB-known MB IDs to file tags, no API calls. Fills only **absent** tags unless `--overwrite`. Preserves mtime.

**Per artist:** queries matched tracks (LocalRelease → MusicBrainzRelease → MusicBrainzReleaseTrack), writes missing `MUSICBRAINZ_ALBUMARTISTID`/`ALBUMID`/`RELEASEGROUPID`/`RELEASETRACKID` (release-track id) + `MUSICBRAINZ_TRACKID` (recording id, from `recordingId`, skipped if NULL).

**Use case:** backfill after a full sync so files become source of truth. Run once.

Cannot combine with `--release`/`--catalogue-gaps`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`.

## Recording-tag mixup (historical, fixed)

Until 2026-09, `write_mb_ids` wrote each track's **release-track** id into the **recording** slot. A normal sync filled it wherever empty; `--overwrite` replaced correct Picard values. MP3s spared only by accident (lofty's generic ID3v2 conversion dropped the frame — `CLAUDE.md` MP3 note). Repaired library-wide by `oneoff/repair_recording_tags.py` on 2026-09-18 (had failed to start on the NAS's Python 3.11 until then — `docs/specs/spec_tidy_observations.md` §17), then deleted with the rest of `oneoff/`. No standing flag anymore — `write_mb_ids` now treats a recording tag equal to the track's own release-track id as absent, so the mixup can't recur.

## Artist Matching (5-step)

1. Embedded MB artist id in any track tag → direct lookup.
2. Embedded MB album id → release-group credits lookup.
3. Name search (phrase-quoted, score ≥90, Jaccard ≥0.5).
4. Raw track artist tag search (when it differs from album artist).
5. Release-group credits search by album title + artist name.

If artist already has an MB id and not overwriting: use it directly, no search.

### Shared lookup cache (read-only)

Every search step consults `MbArtistLookup` before spending a request — filled by index's artist-resolution pass, which has usually already asked MB about these exact strings (9,507 artists here carry no `musicbrainzId` and hit this ladder; before this they re-paid for the same answers every run). Names known at startup bulk-loaded in one query (`warm_exact_artists`); mid-ladder tags use a point lookup.

- **Hits only** — a cached *miss* is the strict resolver's answer (`mb_search_artist_exact`); sync's search is fuzzy (`mb_search_artist`) and may still match where strict didn't, so a miss falls through rather than short-circuits.
- **Sync never writes to `MbArtistLookup`** — its fuzzy matcher scores "Frank Sinatra with Count Basie" vs "Frank Sinatra" at exactly 0.5 and passes; feeding results back would confirm nearly every compound tag as one artist.

## Release Matching Policy

Metadata-wins with a guarded search fallback. 3 tiers in order; embedded ids always win first.

### Consensus (`common::consensus::evaluate`, `docs/no_guessing.md`)
Tiers 1/2 need **unanimity** of embedded ids — no plurality, no majority vote, no "wins if it occurs ≥2 times and beats any rival" tolerance (that scheme is gone as of 2026-09-22). Any disagreement among tagged tracks (or an untagged album field) fails the gate *before any tier runs at all* — the release is parked `UNKNOWN` with a human-readable `statusReason`, not passed to Tier 3. Untagged tracks are absent evidence, never a veto: a folder where only some tracks carry an id still gets a unanimous verdict from the ones that do.

### Allow-list (`scripts/common/src/mb/allowlist.rs`)
Before binding, `is_allowed`: release-group primary type ∈ {Album, EP} (rejects Single/Broadcast/Other); release status = Official (missing status treated Official, matches Tier-2 browse filter); no rejected secondary type (audiobook/audio drama/spokenword/interview/field recording/demo — Compilation/Live/Remix/Soundtrack ride on Album/EP primary and pass; remasters aren't separate MB types, pass automatically). Same allow-list gates `--catalogue-gaps`. Net effect: **library never searches for, browses, or invents a Single.**

### The tagged exception (`is_allowed_tagged`)
Wider gate for a candidate the **files themselves point at** (unanimous `MUSICBRAINZ_ALBUMID`/`RELEASEGROUPID`) — Single-typed groups pass there (status/secondary-type rules unchanged). MB files many owned 4-track CD EPs under a Single group (Radiohead's "Creep", release `130fe36f…`, sat `UNMATCHED` purely on group type). Those bind typed `Single` (artist page's Singles filter already understands it). Search hits (Tier 3) and catalogue gaps still use plain `is_allowed` — nothing ever *invents* a Single.

### Containment (`scripts/sync/src/owned.rs`)
A `LocalRelease` can only bind one MB release, so a release reissued inside something bigger has no bind of its own (e.g. a folder holding disc 1+2 of "In Rainbows" binds to the album group, leaving MB's separate "In Rainbows Disk 2" group looking uncovered; same shape for box sets).

**Containing recordings ≠ owning that release** — different edition/master, why MB models it separately. Stays `MISSING`/gap/acquirable; `detect_containment` only annotates. Pure function scoring tracklists from `mb_get_official_artist_catalogue` (the browse sync already makes; `+recordings` is free) — used to fetch its own browse per gap/artist/run uncached: avg 14.8 calls/artist, 813 worst-case, ~10s each, the single largest avoidable sync cost. Only Official editions considered now (every gap already passed `is_allowed_gap`, so one's always available; narrowing only touches `statusReason`).

Requires: every MB track matched to a distinct local track by normalized title; durations within ±5s where known (rejects e.g. a live version passing title-only — takes run 1-33s off studio); local release is a strict superset; ≥3 MB tracks. Writes `statusReason='Recordings inside "<container>"'` only — no release/track rows, no `mbTrackId` links, no file writes, no queue rejections. Web: `containmentContainerTitle()`. Note carried across syncs (`get_contained_notes_for_artist`); only `--overwrite` re-derives.

> **History:** pre-2026-09 this was `claim_owned_bundle` — marked the contained release `COMPLETE`, rejected downloads, linked the *container's* tracks to the contained release's MB tracks (overwrote real MB identity, corrupted `--only-write-mb-to-files`). 1,583 falsely-owned releases, 11,162 mis-pointed tracks on the live library. Undo: `scripts/sql/undo_owned_bundle_claims.sql`.

### Rejected candidates fall back to search
A rejected tagged candidate now gets one Tier-3 search attempt before giving up (used to be a dead end — files tagged with a bootleg edition's id stayed unmatched forever even with the official album one search away; Radiohead's "A Moon Shaped Pool" tagged to a Bootleg-status id showed as missing next to the local copy). Tags still win when usable; fallback only after rejection.

### Official-only gaps (`is_allowed_gap`)
A release group carries no status itself (status lives on releases inside it), so a bare catalogue gap check treats `status=None` as Official — bootleg soundboards (Album primary + Live secondary, structurally identical to an official live album) flooded gaps this way (Radiohead: 366 MISSING entries, nearly all bootlegs). Fix: both gap paths call `mb_get_official_release_group_ids` once per artist (browse `status=official&type=album|ep&inc=release-groups`, paginated) — `is_allowed_gap` = that set ∧ `is_allowed`. Radiohead: 366→13. ~4 extra calls even for a 500-release artist (server-side filtered). Lookup failure → existing MISSING rows left untouched.

### The three tiers
- **Tier 1** — direct lookup by the folder's unanimous `MUSICBRAINZ_ALBUMID`.
- **Tier 2** — release-group browse by the folder's unanimous `MUSICBRAINZ_RELEASEGROUPID` (also the Tier-1 404 fallback — same id, no special-casing needed). `mb_get_release_tracks` returns only Official editions; `check_release_status` picks the edition (exact track-count sibling preferred; single-edition group binds directly, records `MISSING_TRACKS`/`EXTRA_TRACKS`). No deluxe-sibling upgrade search (removed 2026-09-22 alongside the plurality rescue) — local overshoot scores `EXTRA_TRACKS` directly.
- **Tier 3 (search)** — only when the folder carries no usable id at all, or retry after allow-list rejection. MB search by title+artist (limit 5), takes first shortlist hit satisfying: score ≥85, similar title (`names_are_similar`), passes allow-list, track-count-confident if browsed. Scans the shortlist (not just top hit) — MB scores "Amnesiac" the single 100 ahead of the album, top-hit-only left a 26-track album Unmatched. Never overrides an embedded id, never binds a Single.

Found MB ids written back to file tags after matching (mtime preserved).

> **Duplicate copies bind freely.** The former shared-releaseId guard (unmatched any release already bound elsewhere) is removed — with folder-grouping, multiple `LocalRelease` rows legitimately map to one MB release (duplicate folder copies). They all bind; `duplicate-release` audit rule surfaces them for review instead of blocking at match time.

## Release Status

| Status | Score | How assigned | Badge |
|--------|-------|--------------|-------------|
| `COMPLETE` | 1.0 | Sync: all MB tracks matched, nothing unmatched either side | Green |
| `EXTRA_TRACKS` | 0.85 | Sync: more local tracks than MB tracks | Blue |
| `MISSING_TRACKS` | 0.7 | Sync: MB has tracks not found locally | Orange |
| `INCOMPLETE` | 0.5 | Sync: fallback, some local tracks unmatched | Amber |
| `MISSING` | - | API-only: MB release in catalogue, no local files | Red |
| `UNKNOWN` | - | Index: track deletion resets a matched release for recalc; `releaseId` kept | Gray |
| `UNMATCHED` | - | Index: new release, no match yet. Sync: no id consensus + no confident Tier-3 hit, disallowed type/status, or ambiguous edition. Nuke: unlinked from MB | Beige |

### Status lifecycle
1. Index creates release → `UNMATCHED`.
2. Sync matches → `COMPLETE`/`EXTRA_TRACKS`/`MISSING_TRACKS`/`INCOMPLETE`.
3. Sync can't match → stays `UNMATCHED`.
4. Track deletion on a matched release → `UNKNOWN` (needs recalc, `releaseId` kept).
5. Nuke/delete unlinks → `UNMATCHED` (`releaseId` cleared).
6. Re-sync (`--overwrite`) → re-evaluates, any of the above.

`UNKNOWN` is the one status a plain `./sync` re-evaluates despite already holding a `releaseId` (skip condition is `releaseId.is_some() && status != UNKNOWN`) — used to be inert until someone passed `--overwrite`.

## Rate Limiting

Shared with `index` via `common::mb::api::RateLimiter`. Floor 1100ms (`MB_MIN_DELAY_MS`, clamped 1100-10000), cap 10s. A rate-limit doubles the delay; each success sheds 100ms back toward the floor.

**The limiter is a token schedule, not a lock.** `wait()` claims the next slot from one monotonic schedule regardless of caller count — requests leave at one per 1100ms. A cloned `RateLimiter` is another handle on the **same** schedule (MB's budget is per-application). `MB_MAX_INFLIGHT` (default 8, clamped 1-16) bounds outstanding requests, changes nothing about rate.

**Why concurrency at all:** MB is latency-bound here, not rate-bound. Cold `inc=recordings` browse averages ~10s (max 29.8s), `artist?inc=url-rels+genres+tags` ~10s; warm 0.2s. Serial client reaches only ~0.15 of its ~0.91 req/s allowance. `--concurrency` overlaps the *waiting*. Schedule saturates ~9 in flight at 10s latency; more workers buy nothing beyond that.

**Header caution:** `X-RateLimit-Remaining` is a **shared global pool** (measured `limit:1200`, drifted 886→619→511→472 over 3 requests from this client alone) — nothing derived from it may go below the floor; low-budget branch backs off toward the cap instead (used to return 500ms — 2× the published rate, exactly when the server was busiest).

503 classified **rate-limit** vs **server overload** from body/headers — only the former slows the steady-state pace (server being unwell isn't fixed by going slower). Penalty applies once per request, not per retry; a load-shed 503 may reuse its already-paid slot, but only while nothing else is queued. Retries up to 6× on 429/503, 1s→16s ladder, or `Retry-After` if sent. **Transport failures (timeout/reset/DNS) go on the same ladder** — used to bail immediately with no retry, abandoning the whole artist on one blip (rare serial, not rare concurrent — a cold browse measured 29.8s against the old 30s client timeout, now 60s). Full detail: `docs/scripts/index.md` § Pacing.

### Browse pagination
MB caps `inc=recordings` browses by **response size, not `limit`** ("OK Computer": `release-count:39`, 31 returned for `limit=100`). Every browse loop advances by rows actually returned, stops on the reported count, never a short page — stopping short used to silently drop all 8 `OKNOTOK 1997 2017` editions (exactly what the deluxe-upgrade path looks for).

## Release Deduplication

Index creates one `LocalRelease` per folder — duplicate folder copies of one album are separate rows; sync binds each to the same `MusicBrainzRelease` (no guard blocks it). Web UI groups by MB release for display; `duplicate-release` audit rule lists them for review.

A compilation is one `LocalRelease` linked to many artists via `LocalReleaseArtist` (one link per distinct `albumArtist` tag), bound to one `MusicBrainzRelease` — shared, not duplicated per artist.

## Multi-Edition Handling

Multiple editions (original/remaster/deluxe) stored as separate `MusicBrainzRelease` rows sharing a `releaseGroupId`, each with its own `musicbrainzId`/`disambiguation`. Cover art fetched per-release first, release-group fallback.

## Audio-only track counting

A release's `media[]` can include a non-audio bonus disc (Blu-ray/DVD) alongside CD/vinyl/digital. `flatten_audio_tracks` (single point both `mb_get_release_tracks`/`mb_get_release_by_id` flatten through) drops any medium `is_audio_medium` denies before building the track list everything downstream (`check_release_status`, inserted `MusicBrainzReleaseTrack` rows, web track list/card `trackCount`) consumes.

`is_audio_medium` is a **deny-list** — unrecognized/missing format defaults audio (over-counting is recoverable next sync; an allow-list's failure mode, silently dropping a real audio medium, would delete real tracks). Keys on MB medium **format**, not per-recording `video` (MB reports `false` even on Blu-ray-only media). Fixed incident: 04 Limited Sazabys' "MOON" EP (CD 4 tracks + Blu-ray 1 video track) — a perfect 4/4 rip scored `MISSING_TRACKS` against an inflated 5-track expectation.

The composed `format` display column (`format_from_media`, e.g. "Blu-ray, CD") reads `media[].format` directly, unaffected — display metadata only, not a completeness input.

## Box Sets

Full spec: `docs/sync_decisions.md` (this is a summary). MB has no box-set entity — one Release, N media, no id-level link from a disc to the standalone album it duplicates. `MusicBrainzReleaseMedium` (position/title/format/trackCount) and `MusicBrainzReleaseTrack.recordingId` make both facts queryable.

`index` never folds multi-medium — `./tidy` decides everything (binding, medium assignment, fold/dissolve, equivalence), scoped by whatever artist ids that tidy run got (`boxset::run_repair`, called from `scripts/tidy/src/main.rs`). Moved out of sync's own tail (`docs/scripts/tidy.md`).

- **Binding:** tags agreeing with MB bind folder→release+medium for free; when they don't, `boxset::plan_box_bind`'s tracklist matcher (title+duration ±5s, `find_owning_bundle`) decides, perfect matching only.
- **Equivalence** (`sync::box_editions`, 3 tiers, each only on what's left unlinked, and only for media of a `mediumCount > 1` release - a single-medium release is itself the standalone edition, and comparing it against its own artist's catalogue found itself): tier 1 exact recording-set equi-join (no track-count floor); tier 2 artist-scoped title+duration positional fallback (pre-`recordingId` releases); tier 3 containment match for a bonus-track edition MB never catalogued separately. Written to `equivalentReleaseId`/`equivalentReleaseGroupId`.
- **Fold vs dissolve:** `mediumCount>1` + ≥2 media with an equivalent → dissolve (each disc binds independently, or to the box as rarities/no-equivalent); 0-1 → fold (siblings merge, `LocalReleaseMember` per absorbed folder). Flat `≥2`, no majority clause at any box size.
- **Web:** a dissolved disc is a real bound `LocalRelease`, flows through `buildReleaseCard` into its album's edition group via the normal `releaseGroupId` grouper — no box-specific logic. `UnifiedRelease.boxParent` carries provenance; a rarities disc gets its own row (`"{box title} — {medium title}"`) with a `Box Set` pill. Full web contract: `docs/sync_decisions.md` §7-8.

## End-of-run cleanup

Moved to `./tidy` (`delete_empty_local_releases`/`delete_orphaned_mb_releases`, both take `ArtistScope`) — sync's own tail no longer runs it. Only `--catalogue-gaps` still does its own scoped orphan sweep + retire inline (a per-artist fast pass staying in `sync`) — shared with `./add` via `catalogue_gaps::finish_run`, so the ordering rule below lives in one place.

`delete_orphaned_mb_releases` spares a release local tracks still point at via `mbTrackId` even while no `LocalRelease.releaseId` does — the shape a dissolved box leaves (`docs/sync_decisions.md` §5).

`retire_owned_missing_placeholders` stays global but only pins a placeholder while a `DownloadedRelease` is in a *live* state (`DOWNLOADING`/`ENRICHING`/`READY`/`PROMOTED`) — a merge discarding its download no longer blocks retiring the placeholder once its orphaned MB release is gone. **`delete_orphaned_mb_releases` must run before `retire_owned_missing_placeholders` at every call site** (`./tidy` runs the pair twice; `--catalogue-gaps` here too), or the orphan survives as a non-MISSING sibling and retire deletes the placeholder instead — the wrong survivor (placeholder is what makes it re-downloadable).

## Locking & Resumability

Named DB lock (`"sync"`). Clears stale locks >3min. SIGTERM/Ctrl-C release the lock; second Ctrl-C force-exits.

Run hash in `Settings.syncRunHash`. Restart skips artists already processed (`Artist.syncHash` match). Hash cleared on completion. `--overwrite` generates a new hash. `--release` bypasses the hash.

## Running on NAS

```bash
sudo docker exec dmp sync --from=e --to=fz
```
