import type { Prisma } from '@prisma/client'

// Same ownership rule as /api/artists (server/api/artists/index.get.ts) and /browse: a connected
// duplicate (primaryArtistId set) is folded into its canonical artist elsewhere and never listed on
// its own; manuallyAdded (./add) lets a file-less artist in before it owns any local release.
export const subsonicArtistWhere: Prisma.ArtistWhereInput = {
  primaryArtistId: null,
  OR: [{ localReleases: { some: {} } }, { manuallyAdded: true }],
}

// Only releases with at least one local track are real albums for Subsonic browsing - a MISSING
// placeholder release (a catalogue gap, never downloaded) has no file to stream.
export const subsonicAlbumWhere: Prisma.LocalReleaseWhereInput = {
  tracks: { some: {} },
}
