// Pure logic extracted from composables/useArtistPage.ts so the download-status merge/filter/dedup
// rules are directly unit-testable without booting useFetch/Nuxt lifecycle.
import type { UnifiedRelease } from '~/types/release'
import type { DownloadedReleaseStatus, DlStatusValue, DlInFlightItem } from '~/types/download'
import type { PlayerTrack } from '~/types/player'
import type { Track } from '~/types/track'

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
// have already left the acquisition pipeline. SEARCHING is deliberately excluded too, even though it
// counts as "in flight" everywhere else (Queue tab, poll-keepalive) - this feeds a byte-progress bar
// (DownloadProgress.vue), and a SEARCHING release has no bytes to show a fraction of.
export const filterInFlight = (dlStatusMap: Map<string, DlStatusValue>): DlInFlightItem[] =>
  [...dlStatusMap.values()]
    .filter(d => d.status === 'DOWNLOADING' || d.status === 'ENRICHING')
    .map(d => ({ status: d.status as DownloadedReleaseStatus, percent: d.percent, bytesTransferred: d.bytesTransferred, totalBytes: d.totalBytes }))

// Transient acquisition states: the row will change again on its own, so the page must keep polling.
// READY/FAILED/ABANDONED are terminal - they only move through a user action, and every such action
// kicks a fetch itself, so an idle page has nothing to watch.
const TRANSIENT_DL_STATUSES = ['SEARCHING', 'DOWNLOADING', 'ENRICHING']

export const dlPollNeeded = (dlStatusMap: Map<string, DlStatusValue>): boolean =>
  [...dlStatusMap.values()].some(d => TRANSIENT_DL_STATUSES.includes(d.status))

// Manual-download acquire returns a status even when it didn't start a download (no source, no
// match, bad MB data) - those cases resolve silently server-side (no thrown error) so the button
// click would otherwise look like a no-op. Maps the non-DOWNLOADING statuses to a toast message;
// null means the request genuinely started a download and needs no message.
const ACQUIRE_FAILURE_MESSAGES: Record<string, string> = {
  NO_SOURCE: 'No download source available right now',
  NO_RESULT: 'No match found on the enabled source(s)',
  NO_YEAR: 'Release has no MusicBrainz year - cannot download',
}

export const acquireFailureMessage = (status: string): string | null =>
  ACQUIRE_FAILURE_MESSAGES[status] ?? null

// A local copy can be re-downloaded when it fell short of the MusicBrainz edition it matched:
// MISSING_TRACKS (fewer tracks than MB) or INCOMPLETE (tracks present, titles unmatched) - the same
// two shortfall states the merge gate itself discards a download for (server/utils/promote.ts).
// MISSING has no local copy at all - that's the plain download action, not a replacement.
export const canRedownload = (release: UnifiedRelease, sourceEnabled: boolean): boolean =>
  sourceEnabled
  && !!release.localReleaseId
  && !!release.mbReleaseRowId
  && (release.status === 'MISSING_TRACKS' || release.status === 'INCOMPLETE')

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

// Shared by playAll/shuffleAll: drops missing (undownloaded gap) tracks and maps to the player queue
// shape. Both callers only differ in how the resulting queue is played (sequential vs shuffled).
export const tracksToPlayerTracks = (tracks: Track[], artistSlug: string): PlayerTrack[] =>
  tracks
    .filter(t => !t.missing)
    .map(t => ({
      id: t.id,
      title: t.title || 'Unknown',
      artist: t.artist || 'Unknown',
      album: t.album || 'Unknown',
      duration: t.duration || 0,
      artistSlug,
      releaseImage: null,
      releaseImageUrl: null,
      localReleaseId: t.localReleaseId,
    }))
