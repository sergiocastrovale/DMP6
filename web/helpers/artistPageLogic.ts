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

// Deduplicated folder paths for releases that actually have local files - used to scope
// index/sync scan actions to just this artist's folders.
export const dedupeLocalFolders = (releases: UnifiedRelease[]): string[] => {
  const paths = releases
    .filter(r => r.hasLocal && r.folderPath)
    .map(r => r.folderPath!)
  return [...new Set(paths)]
}
