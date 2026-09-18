// Pure logic extracted from composables/useArtistPage.ts so the download-status merge/filter/dedup
// rules are directly unit-testable without booting useFetch/Nuxt lifecycle.
import type { UnifiedRelease } from '~/types/release'
import type { DownloadedReleaseStatus, DlStatusValue, DlInFlightItem } from '~/types/download'
import type { PlayerTrack } from '~/types/player'
import type { Track } from '~/types/track'

// Attach live download status onto the release it belongs to. The LocalRelease is checked first:
// several cards can share one mbReleaseRowId (duplicate folder copies, or disc halves not yet
// merged), and keying on the MB id alone painted one download's progress bar onto every one of
// them. A gap download (status MISSING, no local copy) has no LocalRelease, so the MB id remains
// the fallback key. Releases with no matching in-flight download pass through unchanged.
export const mergeDownloadStatus = (
  releases: UnifiedRelease[],
  dlStatusMap: Map<string, DlStatusValue>,
): UnifiedRelease[] => {
  if (dlStatusMap.size === 0) { return releases }
  return releases.map((r) => {
    const local = r.localReleaseId ? dlStatusMap.get(r.localReleaseId) : undefined
    // Only fall back to the MB key when no card-specific entry exists anywhere for this release -
    // otherwise a sibling copy's download would leak back onto every card again.
    const mb = r.mbReleaseRowId ? dlStatusMap.get(r.mbReleaseRowId) : undefined
    const dl = local ?? mb
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
export const canRedownload = (release: UnifiedRelease, downloadsEnabled: boolean): boolean =>
  downloadsEnabled
  && !!release.localReleaseId
  && !!release.mbReleaseRowId
  && (release.status === 'MISSING_TRACKS' || release.status === 'INCOMPLETE')

// Favoriting/refresh act on a real LocalRelease id. A gap that only notes containment (owned.rs, see
// CLAUDE.md) has no LocalRelease of its own, so favoriting falls back to the container it names -
// which is what the button says it does, since the gap itself is not owned.
export const favoriteTargetId = (release: UnifiedRelease): string | null =>
  release.localReleaseId || release.bundleParentReleaseId || null

// Resolves a gap's `Recordings inside "X"` note to the actual container UnifiedRelease card in the
// current list, for expand/scroll navigation.
export const findBundleParentRelease = (releases: UnifiedRelease[], release: UnifiedRelease): UnifiedRelease | null =>
  release.bundleParentReleaseId
    ? releases.find(r => r.localReleaseId === release.bundleParentReleaseId) ?? null
    : null

// Box-set row display (docs/sync_decisions.md). A dissolved disc's boxParent points at the *box*
// release it lives in; a rarities/no-equivalent disc's boxParent self-references (releaseId equals
// its own mbReleaseRowId, since mbr IS the box there) - that self-reference is what marks a row as
// needing the "Box Set" pill instead of the dissolved-disc subtitle/disc-label pair.
export const isBoxSetRow = (release: UnifiedRelease): boolean =>
  !!release.boxParent && release.boxParent.releaseId === release.mbReleaseRowId

// Edition-label-style badge for a dissolved box disc: the box's own title stands in for the
// disambiguation/editionLabel a normal edition would carry.
export const boxRowSubtitle = (release: UnifiedRelease): string | null =>
  release.boxParent && !isBoxSetRow(release) ? release.boxParent.title : null

// "disc 3 of 9" - only meaningful for a dissolved disc, which carries the box's own medium count.
export const boxRowDiscLabel = (release: UnifiedRelease): string | null =>
  release.boxParent && !isBoxSetRow(release)
    ? `disc ${release.boxParent.mediumPosition} of ${release.boxParent.mediumCount}`
    : null

// Deduplicated folder paths for releases that actually have local files - the exact album directories,
// used when refreshing one known release.
export const dedupeLocalFolders = (releases: UnifiedRelease[]): string[] => {
  const paths = releases
    .filter(r => r.hasLocal && r.folderPath)
    .map(r => r.folderPath!)
  return [...new Set(paths)]
}

// Mirrors normalize_filter in scripts/common/src/filters.rs: lowercase, drop non-alphanumerics,
// collapse whitespace - so "A.A. Bondy" and "AA Bondy" compare equal, exactly as the Rust side does.
const normalizeFolderName = (s: string): string =>
  s.toLowerCase()
    .split('')
    .filter(c => /[\p{L}\p{N}\s]/u.test(c))
    .join('')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

// Paths to hand `index --folders`, for scanning everything belonging to an artist.
//
// The list mixes granularity on purpose - index walks each entry as given (see walk_roots in
// scripts/index/src/main.rs), so a bare root walks that whole tree and an "Artist/Album" entry walks
// just that album:
//
//   - The artist's OWN roots (their directory, and any connected duplicate-merged artist's) go in
//     bare, so "scan for new files" can still find an album that isn't in the DB yet. NOT
//     dedupeLocalFolders for these: album directories already in the DB find nothing new by
//     construction.
//   - Every OTHER root - a compilation, or another artist's directory holding a release this artist
//     co-owns via a compound albumArtist tag - contributes only the exact album folders concerned.
//     Handing the whole root over re-read a co-artist's entire catalogue (662 files for one Diana
//     Ross duet) on every rebuild, with --overwrite, for one album.
//
// A path segment is a scan target, not artist metadata - identity still comes from tags, per
// CLAUDE.md.
export const artistScanFolders = (
  releases: UnifiedRelease[],
  artistName: string,
  connectedArtistNames: string[] = [],
): string[] => {
  const ownNames = new Set(
    [artistName, ...connectedArtistNames].filter(Boolean).map(normalizeFolderName),
  )
  const paths = dedupeLocalFolders(releases)
  const targets = paths.map((p) => {
    const root = p.split('/')[0]!
    return ownNames.has(normalizeFolderName(root)) ? root : p
  })
  const unique = [...new Set(targets)]
  // No local releases yet (or paths with no directory part): the artist name is the best guess at the
  // folder, and a miss simply scans nothing rather than scanning the wrong thing.
  return unique.length ? unique : [artistName]
}

// The connected (duplicate-merged) artists whose releases are aggregated into this artist's page -
// their directories count as the artist's own scan roots.
export const connectedArtistNames = (releases: UnifiedRelease[]): string[] =>
  [...new Set(releases.map(r => r.connectedArtistName).filter((n): n is string => !!n))]

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

// Whether the URL's ?view already says `mode` - list mode is `view=list`, catalogue mode is no `view` at all.
export const viewQueryMatches = (current: unknown, mode: 'catalogue' | 'list'): boolean =>
  mode === 'list' ? current === 'list' : current === undefined
