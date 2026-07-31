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
  Artist ←→ TrackRelatedArtist ←→ LocalReleaseTrack
```

`LocalRelease.releaseId` is the only link between the two trees. A `LocalRelease` with `releaseId =
NULL` is unmatched/local-only; once sync binds it, `matchStatus` reflects how completely the local
files match the MusicBrainz tracklist (see `ReleaseStatus` enum in CLAUDE.md).

## Issue tables

One table per audit detector (`IssueCorruptedTpe2`, `IssueUnsplitArtist`, `IssueOrphanArtist`,
`IssueDuplicateArtist`, `IssueMissingMetadata`, `IssueEnrichmentGap`), each with an `IssueStatus`
(`DETECTED → PENDING → RESOLVED`, or `PENDING_REVERT` for an undo in flight). `AuditRun` groups a
detection pass; `FixHistory` records what a `./fix` run actually applied (used for the undo flow in
`/issues/history`). See `web/docs/PLAN_tests.md` and the `/issues` pages for how these are consumed.

## Downloads

`DownloadedRelease` is the acquisition-pipeline queue row (one per release being fetched), with
`DownloadStatus` tracking its lifecycle (`DOWNLOADING → ENRICHING → READY → PROMOTED`, or the various
terminal failure states). `DownloadSources` holds per-source (SLSKD/RUTRACKER) config toggles.

## Auth / permissions

`User.role` (`Role` enum: VIEWER/MANAGER/ADMIN) is the coarse gate; `RolePermission` rows are the
fine-grained matrix (`shared/permissionsMatrix.ts` is the single source of truth for what should be in
that table — see `server/utils/permissions.ts`). `User.tokenVersion` lets a session be revoked
server-side (bumped on logout/forced-reset) despite sessions being stateless signed tokens.

## Migrations

No migration history existed until 2026-07-31 (`prisma/migrations/20260731101731_baseline`) — every
prior schema change went through `prisma db push` directly against the shared NAS/dev Postgres. New
schema changes should get a real migration (`prisma migrate dev --name <description>`) going forward.
