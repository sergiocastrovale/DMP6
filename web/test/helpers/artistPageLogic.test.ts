import { describe, expect, it } from 'vitest'
import { artistScanFolders, dedupeLocalFolders, filterInFlight, mergeDownloadStatus, type DlStatusValue } from '../../helpers/artistPageLogic'
import type { UnifiedRelease } from '../../types/release'

const release = (overrides: Partial<UnifiedRelease> = {}): UnifiedRelease => ({
  id: 'r1', title: 'Album', year: 2020, type: 'Album', typeSlug: 'album',
  mbReleaseRowId: null, musicbrainzId: null, releaseGroupId: null, disambiguation: null,
  editionLabel: null, releaseDate: null, packaging: null, country: null, format: null,
  status: 'COMPLETE', image: null, imageUrl: null, trackCount: 0, totalPlayCount: 0,
  localTrackCount: 0, isMusicBrainz: false, hasLocal: true, localReleaseId: 'lr1', folderPath: null,
  ...overrides,
} as UnifiedRelease)

const dlStatus = (overrides: Partial<DlStatusValue> = {}): DlStatusValue => ({
  status: 'DOWNLOADING', downloadedReleaseId: 'dl1', percent: 50, bytesTransferred: 500, totalBytes: 1000,
  ...overrides,
})

describe('mergeDownloadStatus', () => {
  it('attaches download state onto the release matching mbReleaseRowId', () => {
    const releases = [release({ id: 'r1', mbReleaseRowId: 'mb1' }), release({ id: 'r2', mbReleaseRowId: 'mb2' })]
    const map = new Map([['mb1', dlStatus({ status: 'DOWNLOADING', percent: 42 })]])
    const merged = mergeDownloadStatus(releases, map)
    expect(merged[0]).toMatchObject({ downloadState: 'DOWNLOADING', downloadPercent: 42, downloadedReleaseId: 'dl1' })
    expect(merged[1]).not.toHaveProperty('downloadState')
  })

  it('returns the same releases untouched when the status map is empty', () => {
    const releases = [release({ id: 'r1' })]
    expect(mergeDownloadStatus(releases, new Map())).toEqual(releases)
  })

  it('leaves a release alone when it has no mbReleaseRowId', () => {
    const releases = [release({ id: 'r1', mbReleaseRowId: null })]
    const map = new Map([['mb1', dlStatus()]])
    expect(mergeDownloadStatus(releases, map)[0]).not.toHaveProperty('downloadState')
  })
})

describe('filterInFlight', () => {
  it('keeps only DOWNLOADING/ENRICHING entries', () => {
    const map = new Map([
      ['mb1', dlStatus({ status: 'DOWNLOADING' })],
      ['mb2', dlStatus({ status: 'ENRICHING' })],
      ['mb3', dlStatus({ status: 'READY' })],
      ['mb4', dlStatus({ status: 'PROMOTED' })],
    ])
    expect(filterInFlight(map)).toHaveLength(2)
  })

  it('returns an empty array when nothing is in flight', () => {
    const map = new Map([['mb1', dlStatus({ status: 'READY' })]])
    expect(filterInFlight(map)).toEqual([])
  })
})

describe('dedupeLocalFolders', () => {
  it('dedupes repeated folder paths', () => {
    const releases = [
      release({ id: 'r1', hasLocal: true, folderPath: '/music/a' }),
      release({ id: 'r2', hasLocal: true, folderPath: '/music/a' }),
    ]
    expect(dedupeLocalFolders(releases)).toEqual(['/music/a'])
  })

  it('excludes releases with no local files or no folderPath', () => {
    const releases = [
      release({ id: 'r1', hasLocal: false, folderPath: '/music/b' }),
      release({ id: 'r2', hasLocal: true, folderPath: null }),
    ]
    expect(dedupeLocalFolders(releases)).toEqual([])
  })
})

describe('artistScanFolders', () => {
  it('reduces album paths to their distinct top-level artist directories', () => {
    // The reason this exists: `index --folders` walks exactly the paths it is handed, so passing the
    // album directories means a newly added album is never seen. The artist directory is the scan root.
    const releases = [
      release({ id: 'r1', hasLocal: true, folderPath: 'Miles Davis/Kind of Blue' }),
      release({ id: 'r2', hasLocal: true, folderPath: 'Miles Davis/Bitches Brew' }),
    ]
    expect(artistScanFolders(releases, 'Miles Davis')).toEqual(['Miles Davis'])
  })

  it('keeps every distinct root when an artist spans more than one directory', () => {
    const releases = [
      release({ id: 'r1', hasLocal: true, folderPath: 'Miles Davis/Kind of Blue' }),
      release({ id: 'r2', hasLocal: true, folderPath: 'Various Artists/Jazz Comp' }),
    ]
    expect(artistScanFolders(releases, 'Miles Davis')).toEqual(['Miles Davis', 'Various Artists'])
  })

  it('falls back to the artist name when there are no local releases yet', () => {
    expect(artistScanFolders([], 'Aphex Twin')).toEqual(['Aphex Twin'])
    expect(artistScanFolders([release({ hasLocal: false, folderPath: 'x/y' })], 'Aphex Twin')).toEqual(['Aphex Twin'])
  })

  it('treats a root-level path as its own scan root', () => {
    const releases = [release({ id: 'r1', hasLocal: true, folderPath: 'Loose Album' })]
    expect(artistScanFolders(releases, 'Whoever')).toEqual(['Loose Album'])
  })
})
