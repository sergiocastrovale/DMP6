import { describe, expect, it } from 'vitest'
import { matchTorrentFolders, normalizeTitle, type MatchableRelease } from '../../../server/utils/torrentMatch'
import type { QbitFile } from '../../../server/utils/qbittorrent'

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle("Who's Next!")).toBe('who s next')
  })

  it('strips diacritics', () => {
    expect(normalizeTitle('Café Del Mar')).toBe('cafe del mar')
  })

  it('strips bracketed qualifiers', () => {
    expect(normalizeTitle('Album Title [FLAC]')).toBe('album title')
    expect(normalizeTitle('Album Title (Deluxe Edition)')).toBe('album title')
    expect(normalizeTitle('Album Title {Remaster}')).toBe('album title')
  })

  it('collapses whitespace', () => {
    expect(normalizeTitle('  Too    Many   Spaces  ')).toBe('too many spaces')
  })
})

const file = (index: number, name: string, size = 1000): QbitFile => ({ index, name, size, progress: 0, priority: 1 })

describe('matchTorrentFolders', () => {
  it('returns empty for no audio files or no releases', () => {
    expect(matchTorrentFolders([], [{ id: '1', title: 'X', year: null, releaseGroupId: null }])).toEqual([])
    expect(matchTorrentFolders([file(0, 'Album/track.flac')], [])).toEqual([])
  })

  it('matches a folder to a release by normalized title', () => {
    const files = [file(0, 'Geogaddi/01. Track.flac'), file(1, 'Geogaddi/02. Track.flac')]
    const releases: MatchableRelease[] = [{ id: 'r1', title: 'Geogaddi', year: 2002, releaseGroupId: null }]
    const matches = matchTorrentFolders(files, releases)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.release.id).toBe('r1')
    expect(matches[0]!.folder).toBe('Geogaddi')
    expect(matches[0]!.fileIndexes).toEqual([0, 1])
    expect(matches[0]!.files.map(f => f.filename)).toEqual(['01. Track.flac', '02. Track.flac'])
  })

  it('skips root-level files with no album folder', () => {
    const files = [file(0, 'track.flac')]
    const releases: MatchableRelease[] = [{ id: 'r1', title: 'track', year: null, releaseGroupId: null }]
    expect(matchTorrentFolders(files, releases)).toEqual([])
  })

  it('prefers a folder mentioning the release year when several folders match', () => {
    const files = [
      file(0, 'Geogaddi (2002)/01.flac'),
      file(1, 'Geogaddi Live/01.flac'),
    ]
    const releases: MatchableRelease[] = [{ id: 'r1', title: 'Geogaddi', year: 2002, releaseGroupId: null }]
    const matches = matchTorrentFolders(files, releases)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.folder).toBe('Geogaddi (2002)')
  })

  it('assigns each folder to at most one release, longest title first', () => {
    const files = [
      file(0, 'Greatest Hits/01.flac'),
      file(1, 'Greatest Hits Deluxe/01.flac'),
    ]
    const releases: MatchableRelease[] = [
      { id: 'short', title: 'Greatest Hits', year: null, releaseGroupId: null },
      { id: 'long', title: 'Greatest Hits Deluxe', year: null, releaseGroupId: null },
    ]
    const matches = matchTorrentFolders(files, releases)
    expect(matches).toHaveLength(2)
    const byId = Object.fromEntries(matches.map(m => [m.release.id, m.folder]))
    expect(byId.long).toBe('Greatest Hits Deluxe')
    expect(byId.short).toBe('Greatest Hits')
  })

  it('skips titles that normalize to fewer than 2 characters', () => {
    const files = [file(0, 'X/01.flac')]
    const releases: MatchableRelease[] = [{ id: 'r1', title: '!', year: null, releaseGroupId: null }]
    expect(matchTorrentFolders(files, releases)).toEqual([])
  })

  it('ignores non-audio files when grouping', () => {
    const files = [file(0, 'Geogaddi/cover.jpg'), file(1, 'Geogaddi/01.flac')]
    const releases: MatchableRelease[] = [{ id: 'r1', title: 'Geogaddi', year: null, releaseGroupId: null }]
    const matches = matchTorrentFolders(files, releases)
    expect(matches[0]!.files).toHaveLength(1)
  })
})
