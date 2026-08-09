// Pure logic extracted from composables/useArtistPage.ts so the download-status merge/filter/dedup
// rules are directly unit-testable without booting useFetch/Nuxt lifecycle.
import type { UnifiedRelease } from '~/types/release'
import type { DownloadedReleaseStatus } from '~/types/download'

export type DlStatusValue = { status: string, downloadedReleaseId: string, percent: number, bytesTransferred: number, totalBytes: number }

export interface DlInFlightItem {
  status: DownloadedReleaseStatus
  percent: number
  bytesTransferred: number
  totalBytes: number
}

// Attach live download status onto whichever release shares its mbReleaseRowId. Releases with no
// matching in-flight download pass through unchanged.
export const mergeDownloadStatus = (
  releases: UnifiedRelease[],
  dlStatusMap: Map<string, DlStatusValue>,
): UnifiedRelease[] => {
  if (dlStatusMap.size === 0) { return releases }
  return releases.map((r) => {
    const dl = r.mbReleaseRowId ? dlStatusMap.get(r.mbReleaseRowId) : undefined
    return dl ? { ...r, downloadState: dl.status, downloadedReleaseId: dl.downloadedReleaseId, downloadPercent: dl.percent } : r
  })
}

// Only DOWNLOADING/ENRICHING count as "in flight" for the header aggregate bar - READY/PROMOTED/etc.
// have already left the acquisition pipeline.
export const filterInFlight = (dlStatusMap: Map<string, DlStatusValue>): DlInFlightItem[] =>
  [...dlStatusMap.values()]
    .filter(d => d.status === 'DOWNLOADING' || d.status === 'ENRICHING')
    .map(d => ({ status: d.status as DownloadedReleaseStatus, percent: d.percent, bytesTransferred: d.bytesTransferred, totalBytes: d.totalBytes }))

// Deduplicated folder paths for releases that actually have local files - the exact album directories,
// used when refreshing one known release.
export const dedupeLocalFolders = (releases: UnifiedRelease[]): string[] => {
  const paths = releases
    .filter(r => r.hasLocal && r.folderPath)
    .map(r => r.folderPath!)
  return [...new Set(paths)]
}

// Top-level directories to hand `index --only`, for scanning everything belonging to an artist.
//
// NOT dedupeLocalFolders: those are the album directories already in the DB, and `index --folders`
// walks exactly the paths it is given (see walk_roots in scripts/index/src/main.rs). Scanning them
// finds nothing new by construction, so "check for new files" could never find a new album. The
// artist's own directory is the right scan root, and `--only` also picks up connected (duplicate-
// merged) artists' folders, which the --folders path skips.
//
// The first path segment is a scan target, not artist metadata - identity still comes from tags, per
// CLAUDE.md. Index derives the same value itself when expanding connected artists.
export const artistScanFolders = (releases: UnifiedRelease[], artistName: string): string[] => {
  const roots = dedupeLocalFolders(releases)
    .map(p => p.split('/')[0])
    .filter((s): s is string => !!s)
  const unique = [...new Set(roots)]
  // No local releases yet (or paths with no directory part): the artist name is the best guess at the
  // folder, and a miss simply scans nothing rather than scanning the wrong thing.
  return unique.length ? unique : [artistName]
}
