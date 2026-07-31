# Tagging

DMP treats **embedded audio tags as the source of truth** for artist/album/track identity — never
filesystem paths or folder names (see `CLAUDE.md`'s Project Conventions). When a file has a valid
`MUSICBRAINZ_ALBUMID`/`MUSICBRAINZ_TRACKID` tag, sync trusts it directly without re-verifying.

## Detecting bad tags: `./audit`

Six detector types, each writing typed rows to the DB (`IssueCorruptedTpe2`, `IssueUnsplitArtist`,
`IssueOrphanArtist`, `IssueDuplicateArtist`, `IssueMissingMetadata`, `IssueEnrichmentGap`):

- **Corrupted TPE2** — `albumArtist` contains garbage (bare track numbers, bitrate suffixes, leaked
  file-path fragments) instead of a real artist name.
- **Unsplit artists** — a compound tag (`"Artist A & Artist B"`, `"Artist A feat. Artist B"`) stored as
  one artist instead of split into its members.
- **Orphan artists** — artist rows with no remaining tracks/releases (stale after a delete/re-tag).
- **Duplicate artists** — two artist rows that normalize to the same name (case/whitespace/`the`-prefix
  variants) and should be merged.
- **Missing metadata** — tracks missing core fields (title, artist, album, track number, year).
- **Enrichment gaps** — missing BPM, mood, AcoustID, or other enrichment-only fields (SongKong's job,
  see `docs/features_downloader.md`'s SongKong section).

Full detector detail (exact regex patterns, thresholds): `docs/scripts/audit.md`.

## Reviewing and queuing fixes: `/issues`

The `/issues` page shows counts per type; `/issues/[type]` is a per-type table where you inspect the
proposed fix, edit it if needed, and queue it (`DETECTED → PENDING`). `/issues/history` shows what was
actually applied, with an undo path (`PENDING_REVERT → RESOLVED` reversed).

## Applying fixes: `./fix`

Applies all PENDING rows of a given type — rewrites the actual audio file tag (corrupted/unsplit/
missing) or does a DB-level merge (duplicates) / delete (orphans). File-writing fix types need a
`./refresh --only="artist"` afterward to re-index the rewritten tags. Full detail:
`docs/scripts/fix.md`.

## MusicBrainz ID backfill

`./sync --only-write-mb-to-files` writes MB IDs already known in the DB back into file tags without
any API calls — useful after a fresh match to make future syncs skip re-verification entirely.
