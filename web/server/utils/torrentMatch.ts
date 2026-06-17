import { isAudioFile } from '~/server/utils/slskd'
import type { QbitFile } from '~/server/utils/qbittorrent'

// Match the album folders inside a torrent (often a whole discography pack) against an artist's MISSING
// MusicBrainz releases, so one torrent can fill several gaps at once. Moderate strictness: a folder
// matches a release on normalized title (artist is implicit — the torrent is already artist-scoped);
// the year is only a tiebreaker. The torrent is already known to belong to the searched artist.

export interface MatchableRelease {
  id: string
  title: string
  year: number | null
  releaseGroupId: string | null
}

export interface FolderMatch {
  release: MatchableRelease
  folder: string // torrent-relative directory of this album (what relocate scans / torrentFolder)
  fileIndexes: number[] // qBit file indexes belonging to this folder (for selective download)
  files: { filename: string; size: number }[] // audio files (basenames matter for relocate)
}

// Strip diacritics, bracketed qualifiers (FLAC), and punctuation; collapse to single spaces.
export const normalizeTitle = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const dirOf = (path: string): string => {
  const p = path.replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
const baseOf = (path: string): string => path.replace(/\\/g, '/').split('/').pop() || path

/**
 * Group a torrent's audio files by their immediate parent folder and assign each folder to at most one
 * MISSING release (and each release to at most one folder). Greedy by descending title length so the
 * most specific titles claim their folder first; year breaks ties when several folders match.
 */
export function matchTorrentFolders(files: QbitFile[], releases: MatchableRelease[]): FolderMatch[] {
  const audio = files.filter(f => isAudioFile(f.name))
  if (audio.length === 0 || releases.length === 0) return []

  // folder -> its audio files
  const byFolder = new Map<string, QbitFile[]>()
  for (const f of audio) {
    const dir = dirOf(f.name)
    if (!dir) continue // skip torrent-root files (no album folder to match on)
    const list = byFolder.get(dir) || []
    list.push(f)
    byFolder.set(dir, list)
  }

  const folders = [...byFolder.keys()].map(dir => ({ dir, norm: normalizeTitle(baseOf(dir)) }))
  const usedFolders = new Set<string>()
  const matches: FolderMatch[] = []

  for (const rel of [...releases].sort((a, b) => b.title.length - a.title.length)) {
    const normTitle = normalizeTitle(rel.title)
    if (normTitle.length < 2) continue
    const candidates = folders.filter(f => !usedFolders.has(f.dir) && f.norm.includes(normTitle))
    if (candidates.length === 0) continue
    // Prefer a folder whose name also mentions the release year.
    const pick = (rel.year ? candidates.find(c => c.norm.includes(String(rel.year))) : undefined) ?? candidates[0]!
    usedFolders.add(pick.dir)
    const folderFiles = byFolder.get(pick.dir)!
    matches.push({
      release: rel,
      folder: pick.dir,
      fileIndexes: folderFiles.map(f => f.index),
      files: folderFiles.map(f => ({ filename: baseOf(f.name), size: f.size })),
    })
  }
  return matches
}
