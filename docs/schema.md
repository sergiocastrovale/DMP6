# DB schema

The Prisma schema (`web/prisma/schema.prisma`) is the source of truth — this doc is an orientation
guide, not a mirror of it. See `CLAUDE.md`'s **Data Model** section for the day-to-day summary
(dual tree, key link columns, enums). This doc covers the parts CLAUDE.md doesn't.

## Dual tree, one more time

```
MusicBrainz tree (canonical):
  Artist ←→ MusicBrainzReleaseArtist ←→ MusicBrainzRelease → MusicBrainzReleaseTrack

Local tree (files on disk):
  Artist ←→ LocalReleaseArtist ←→ LocalRelease → LocalReleaseTrack
  Artist ←→ TrackRelatedArtist ←→ LocalReleaseTrack   (credits: "appears on")
```

`LocalRelease.releaseId` is the only link between the two trees. A `LocalRelease` with `releaseId =
NULL` is unmatched/local-only; once sync binds it, `matchStatus` reflects how completely the local
files match the MusicBrainz tracklist (see `ReleaseStatus` enum in CLAUDE.md).

**Grouping is per folder.** A `LocalRelease` = one physical folder (`groupKey = "folder:{folderPath}"`);
per-track MB ids no longer split a folder (see `docs/scripts/index.md`).
Two folder-copies of the same album are two `LocalRelease` rows that bind to the *same*
`MusicBrainzRelease` — legitimate duplicates, surfaced by the `duplicate-release` audit rule. A
compilation is **one** `LocalRelease` linked to N artists via the many-to-many `LocalReleaseArtist`
table (one main-artist link per distinct `albumArtist` tag) — shared across those artists' pages,
not duplicated per artist.

## Issue tables

One table per audit detector (`IssueCorruptedTpe2`, `IssueOrphanArtist`,
`IssueDuplicateArtist`, `IssueMissingMetadata`, `IssueEnrichmentGap`, `IssueDuplicateRelease`,
`IssueMismatchedReleaseId`), each with an `IssueStatus` (`DETECTED → PENDING → RESOLVED`, or
`PENDING_REVERT` for an undo in flight). The two release-pair detectors are audit-only (no `./fix`
action, like `enrichment`): `IssueDuplicateRelease` flags near-identical local copies that share one
MB release; `IssueMismatchedReleaseId` flags different-title local releases that wrongly share one MB
release. `AuditRun` groups a detection pass; `FixHistory` records what a `./fix` run actually applied
(used for the undo flow in `/issues/history`). See the `/issues` pages for how these are consumed.

## Downloads

`DownloadedRelease` is the acquisition-pipeline queue row (one per release being fetched), with
`DownloadStatus` tracking its lifecycle (`SEARCHING → DOWNLOADING → ENRICHING → READY → PROMOTED`, or
the various terminal failure states). `DownloadSources` holds per-source (SLSKD/RUTRACKER) config toggles.

## Auth / permissions

`User.role` (`Role` enum: VIEWER/MANAGER/ADMIN) is the coarse gate; `RolePermission` rows are the
fine-grained matrix (`shared/permissionsMatrix.ts` is the single source of truth for what should be in
that table — see `server/utils/permissions.ts`). `User.tokenVersion` lets a session be revoked
server-side (bumped on logout/forced-reset) despite sessions being stateless signed tokens.

## Migrations

No migration history existed until 2026-07-31 (`prisma/migrations/20260731101731_baseline`) — every
prior schema change went through `prisma db push` directly against the shared NAS/dev Postgres. New
schema changes should get a real migration (`prisma migrate dev --name <description>`) going forward.

## Artist ownership vs credits

`LocalReleaseArtist` means the artist **owns** that release (their discography — shown in `/browse`,
counted in stats, synced to MusicBrainz). `TrackRelatedArtist` means they are merely **credited** on a
track ("appears on" — own page and searchable, but excluded from browse/stats/sync).

An artist owning nothing but holding credits is legitimate (Count Basie guesting on a Sinatra album). That
state is **derived**, never stored: "owns something" is `EXISTS(LocalReleaseArtist)`. There is deliberately
no flag column — a cached boolean is what silently read 0 for two and a half months.

`MbArtistLookup` caches MusicBrainz name resolution, hits **and** misses (`mbid IS NULL` = confirmed
not-found, re-checked after 30 days), so the 1.1 req/s MB budget is paid at most once per distinct name.
`LocalReleaseTrack.artists[]` / `mbArtistIds[]` (plus the albumArtist equivalents) hold the multi-value tag
frames in file order; when the two line up they are an authoritative pre-split artist list from Picard.
