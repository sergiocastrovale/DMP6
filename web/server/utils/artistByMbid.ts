import { prisma } from './prisma'

export interface ResolvedArtist {
  slug: string
  name: string
}

// Shared by by-mbid and added: looks up an Artist by MusicBrainz id, resolved to its primary artist
// when the match is a connected duplicate.
export async function findArtistByMbid(mbid: string): Promise<ResolvedArtist | null> {
  const artist = await prisma.artist.findFirst({
    where: { musicbrainzId: mbid },
    select: { slug: true, name: true, primaryArtist: { select: { slug: true, name: true } } },
  })
  if (!artist) {return null}
  return artist.primaryArtist ?? { slug: artist.slug, name: artist.name }
}
