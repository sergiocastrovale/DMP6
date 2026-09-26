import type { Prisma } from '@prisma/client'
import { verifyImage } from '~/server/utils/images'

// The release "tile" the home page, timeline and search render: title, cover, type, one artist and one genre.
// `latest`, `last-played`, `archive`, `updated`, the timeline and search all built this by hand, each with its own
// copy of an `include` (which selects every LocalRelease column - folderPath, statusReason, groupKey... - that the
// tile never shows) and of the same mapping. One select and one mapper now, so they can't drift.
export const RELEASE_TILE_SELECT = {
  id: true,
  title: true,
  year: true,
  image: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  artists: { take: 1, select: { artist: { select: { id: true, name: true, slug: true } } } },
  release: { select: { id: true, title: true, type: { select: { name: true } } } },
  // One genre for the tile's subtitle, not the release's whole track list.
  tracks: { where: { genre: { not: null } }, select: { genre: true }, take: 1 },
} as const satisfies Prisma.LocalReleaseSelect

// Same tile without the genre lookup, for lists that don't show one (timeline, search).
export const RELEASE_TILE_SELECT_NO_GENRE = { ...RELEASE_TILE_SELECT, tracks: false } as const satisfies Prisma.LocalReleaseSelect

interface TileRow {
  id: string
  title: string
  year: number | null
  image: string | null
  imageUrl: string | null
  artists: { artist: { id: string, name: string, slug: string } }[]
  release: { id: string, title: string, type: { name: string } | null } | null
  tracks?: { genre: string | null }[]
}

export const firstArtist = <T>(row: { artists: { artist: T }[] }): T | null => row.artists[0]?.artist ?? null

export const toReleaseTile = (row: TileRow) => ({
  id: row.id,
  title: row.title || row.release?.title || 'Unknown Release',
  releaseType: row.release?.type?.name || null,
  year: row.year,
  ...verifyImage(row.image, row.imageUrl, 'releases'),
  genre: row.tracks?.[0]?.genre || null,
  artist: firstArtist(row),
  musicBrainzId: row.release?.id || null,
})
