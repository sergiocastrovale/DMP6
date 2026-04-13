# Scripts: delete

Permanently removes a single artist, their entire local + MusicBrainz catalogue, and all associated images (local + S3). Cascades into "ghost" co-artists whose entire catalogue is contained within the deleted releases, but leaves any co-artist with releases beyond the shared set untouched.

## Build

```bash
cd scripts/delete && cargo build --release
```

## Usage

```bash
./delete "Artist Name"                     # Confirm with the artist's name, then delete
./delete "Artist1;Artist2;Artist3"         # Delete multiple artists at once
./delete "Artist Name" --dry-run           # Preview the plan, change nothing
./delete "Artist Name" --y                 # Skip the confirmation prompt
```

The artist name match is **exact and case-insensitive**. Separate multiple artists with `;`. If any name matches multiple artists, the script lists them and exits — refine the input.

When deleting multiple artists, plans are merged — releases shared between targets are counted once, and cascading is computed across all targets combined. Confirmation requires typing `yes` instead of the artist name.

## What gets deleted

For the **target artist** and any **cascaded co-artists**:

- The `Artist` row (cascades to `ArtistUrl`, `LocalReleaseArtist`, `MusicBrainzReleaseArtist`, `TrackArtist`)
- Their `_ArtistGenres` junction rows (Prisma implicit M:N, no FK cascade)
- Their artist image — local file under `web/public/img/artists/` and S3 object `artists/<slug>.jpg`

For all the target's **local releases**:

- The `LocalRelease` row (cascades to `LocalReleaseTrack`, `FavoriteTrack`, `PlaylistTrack`, `LocalReleaseArtist`)
- The cover art — local file under `web/public/img/releases/` and S3 object `releases/<id>.jpg`

For all the target's **MusicBrainz releases**:

- The `MusicBrainzRelease` row (cascades to `MusicBrainzReleaseTrack`, `MusicBrainzReleaseArtist`, `FavoriteRelease`)

After the explicit deletes, two sweeps run inside the same transaction to clean up any `LocalRelease` / `MusicBrainzRelease` left without any artist link.

The whole DB delete is wrapped in a single transaction. If anything fails, the entire deletion rolls back. Image deletion happens **before** the DB transaction, so a transaction rollback may leave a few images orphaned in S3 — they'll be picked up by `./clean` (which already processes the `S3DeletionQueue` for orphaned images).

## The cascade rule

A co-artist `Y` is deleted **only if both** are true:

- Every `LocalReleaseArtist` row for `Y` points to a release in the target's local-release set
- Every `MusicBrainzReleaseArtist` row for `Y` points to a release in the target's MB-release set

Equivalent: `Y`'s entire catalogue is a subset of what we're already deleting. If `Y` has even one release outside the deletion frontier, `Y` is left alone — only its junction rows for the deleted releases are removed by the cascade. This protects established artists who happen to share a single split EP or compilation with the target.

The check is single-pass: a cascaded artist's catalogue is by definition already inside the deletion set, so nothing new gets pulled in.

## Confirmation

By default the script prints the full plan and asks you to type `y` to confirm. Anything else aborts. Use `--y` to skip the prompt.

## Statistics

After a successful delete, the `Statistics` row is refreshed in place — `artists`, `mainArtists`, `relatedArtists`, `tracks`, `releases`, `releasesWithCoverArt`, `artistsWithCoverArt`, `playtime`, `plays`, and the MB sync counters are all recomputed from the current state of the tables.

## When to use this vs. other scripts

| Tool | Use when |
|---|---|
| `./delete "Name"` | You want to permanently remove a specific artist and everything tied to them |
| `./sync --only="Name" --overwrite` | You want to re-sync an artist from scratch (DB only — files on disk are kept and re-indexed) |
| `python3 scripts/fix_artist_names.py --cleanup --apply` | Remove orphan artists and empty releases left behind by metadata fixes |
| `./nuke` / `./nuke --local-only` | Full DB wipe, all-or-nothing |
