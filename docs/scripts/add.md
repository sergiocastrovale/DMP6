# Scripts: add

Adds a MusicBrainz artist to the library **before any file for them exists**: an empty folder under
`MUSIC_DIR`, an `Artist` row (`manuallyAdded = true`), and a catalogue-gaps pass so the artist page
shows its MISSING releases right away. Web caller: `/add` (browse's "+ Add artist" button), via
`components/artist/add/Search.vue` and the terminal toast/sidebar flow.

## Why not `./refresh`

`./refresh` chains `./index` then `./sync` (+`./tidy`). Neither step can bootstrap a file-less artist:

- `./index --folders X` on a brand-new empty folder finds nothing to scan, emits no artist ids, and
  `./refresh` prints `No artists to sync.` and stops.
- Even given an artist id some other way, plain `./sync` skips any artist with no local releases
  outright (`sync/src/main.rs`, "No local releases - skipped").

`./sync --catalogue-gaps` is the pass built for a file-less, MB-linked artist. `./add` creates the
Artist row itself, then calls straight into `dmp_sync::catalogue_gaps::fill_catalogue_gaps`, scoped to
just the one artist id it created.

## Build

```bash
cd scripts && cargo build --release -p add
```

`add` depends on `sync`'s library target (`dmp_sync`) for `catalogue_gaps` and `mb_api`, and on
`common` for MB HTTP, images, S3, slug, lock and progress-reporting.

## Usage

```bash
./add --mbid <musicbrainz-artist-uuid>              # add, unmonitored
./add --mbid <uuid> --monitored                     # add and enroll in the download worker
./add --mbid <uuid> --dry-run                       # print what would happen, no writes
./add --mbid <uuid> --web                           # PROGRESS:{json} lines for the web terminal
```

## CLI Flags

| Flag | Meaning |
|---|---|
| `--mbid <uuid>` | Required. MusicBrainz artist id. |
| `--monitored` | Sets `Artist.monitored = true` on creation, so the download worker's monitoring trickle picks the artist up immediately instead of waiting for someone to flip it on later. Gated `downloads.crud` at the web layer (`server/utils/terminalCommand.ts`'s `FLAG_PERM`), separately from `./add` itself (`sync.run`) — a MANAGER with only `sync.run` can add artists but not opt them into downloads. |
| `--dry-run` | Looks up the artist on MusicBrainz, prints name/slug/folder/country/monitored, and exits before touching disk or the DB. Still takes the scan lock (so a real run can't start underneath it) and releases it before exiting. |
| `--web` | Emits `PROGRESS:{...}` lines for the web terminal (same `Reporter` as `index`/`sync`/`tidy`). |

## Flow

1. Validate `--mbid` (`common::filters::sanitize_mb_id`).
2. Take the scan lock (`common::lock::acquire_lock`, binary name `"add"`) — same exclusive lock
   `index`/`sync`/`tidy` share, so `./add` can't race a library-wide scan.
3. One MusicBrainz call: `mb_get_artist_detail` → authoritative name, area (→ ISO country), relations
   (image source). The name typed into the `/add` search box is never trusted directly — CLAUDE.md
   "Embedded MB IDs are definitive."
4. Derive `slug = common::slug::make_slug(name)` (the same function `index`'s `ensure_artist` uses —
   critical, or a name needing transliteration could fork into a second Artist row once real files
   land) and `folder = folder_name(name)` (path-separator/NUL sanitize, own module, unit tested).
5. **Duplicate check** — any of the following aborts with exit code 3, nothing written:
   - an existing Artist row with this `musicbrainzId` (resolved through `primaryArtistId` if it's a
     connected duplicate, so the message names the primary artist);
   - an existing Artist row with this slug;
   - the folder already exists under `MUSIC_DIR`.
6. `--dry-run` stops here (after step 5, before any write).
7. `mkdir` the folder (non-recursive; refuses a path whose parent isn't exactly `MUSIC_DIR`, guarding
   against a sanitized name that still contains `..`).
8. Insert the `Artist` row: `manuallyAdded = true`, `musicbrainzId`, `country`, `monitored` from
   `--monitored`, totals at 0. A unique-constraint race here (another `./add` or a manual insert won
   the slug) removes the just-created folder and exits 3.
9. Artist image, same path sync uses (`common::images::download_artist_image` +
   `record_artist_image`) — non-fatal on failure.
10. `dmp_sync::catalogue_gaps::fill_catalogue_gaps`, scoped to just this artist id (`artist_ids: Some(&[id])`,
    not `--only`/`--exact` name filtering — two same-named artists, e.g. "NAPA (PT)"/"NAPA (CL)", or a
    name containing `;`, would otherwise cross). Then the same tail every gaps-pass caller shares,
    `catalogue_gaps::finish_run` (see docs/scripts/sync.md): orphan sweep, retire owned MISSING
    placeholders, `update_statistics`. Stamps `lastGapsCheckedAt` so the monitor loop's own gaps
    trickle doesn't immediately redo this artist.
11. Release the lock, exit 0.

A gaps-pass failure at step 10 does **not** roll back the artist or folder — they're valid, and a
failed catalogue fetch is retried the normal way, from the artist page's own sync controls. It exits 1.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Created (or `--dry-run` completed cleanly). |
| 1 | Failure — bad mbid, no `MUSIC_DIR`, lock held, MB lookup failed, DB error, gaps pass failed. |
| 3 | Already exists — mbid, slug, or folder collision. The web caller (`Search.vue`) uses this code specifically to show `Dialog.vue`'s error instead of a generic failure toast; every other non-zero code is a generic failure. |

## `manuallyAdded`

`Artist.manuallyAdded` (migration `20260915000000_artist_manually_added`) is the one place ownership
in this library is a stored flag rather than derived — see CLAUDE.md Data Model. Set only by `./add`'s
insert; `common::db::ensure_artist`'s `ON CONFLICT (slug) DO UPDATE` never touches it, so the flag
survives real files arriving later (nothing un-sets it — an artist that was manually added stays
flagged even once it owns releases, which is harmless since every rule keyed on it is an `OR`/`AND NOT`
addition to an ownership check that would already pass).

Consulted by:
- `web/server/api/artists/index.get.ts` (browse) — `OR manuallyAdded` alongside the usual
  `localReleases: { some: {} }`.
- `scripts/common/src/statistics.rs` + `scripts/nuke/src/main.rs`'s `refresh_statistics` — `mainArtists`
  counts it in, `creditArtists` excludes it.
- `scripts/index/src/deletion.rs`'s `delete_orphan_artists` and `scripts/audit/src/orphans.rs`'s
  no-releases detector — both exclude `manuallyAdded`, or the very next unscoped `./index`/`./audit`
  would flag and delete an artist added before it had any links at all. The two must stay in sync.

## Web caller

`ALLOWED_COMMANDS`/`COMMAND_PERM` (`server/utils/terminalCommand.ts`): `./add` → `sync.run`, same as
`index`/`sync`/`tidy`. `--monitored` carries its own gate via `FLAG_PERM` (`downloads.crud`), checked
in `server/api/terminal/run.post.ts` alongside the existing destructive-flag check. `./add` is in
`WEB_MODE_COMMANDS` so `--web` is auto-appended.

`components/artist/add/Search.vue` runs it as a single `terminal.run('./add', args, session)` (not a
sequence — there's no `./tidy` step here, since the gaps pass isn't a full sync and doesn't touch
`lastSyncedAt`). On exit 0 it calls `POST /api/artists/added/[mbid]` (`./add` writes straight to
Postgres and can't reach Redis, so this busts the `artists:*` browse cache and returns the slug to
navigate to) and routes to `/artist/{slug}`; on exit 3 it re-resolves the slug via
`GET /api/artists/by-mbid/[mbid]` and shows `ErrorDialog.vue`; anything else is a toast.
