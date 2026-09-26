import type { PlayerTrack } from '~/types/player'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { randomArtistTrackIds } from '~/server/utils/artistTracks'
import { ARTIST_SHUFFLE_SIZE } from '~/helpers/constants'

// A random selection of an artist's tracks, ready for the player - what the "Shuffle" button and the player's
// artist-shuffle mode need. The full ordered list (/tracks) would ship every row of a 5,000-track artist just
// to have the client throw most of it away; the queue only ever keeps a couple of hundred anyway.
export default defineEventHandler(async (event): Promise<PlayerTrack[]> => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const artist = await prisma.artist.findUnique({ where: { slug }, select: { id: true } })
  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  const ids = await randomArtistTrackIds(artist.id, ARTIST_SHUFFLE_SIZE)
  if (ids.length === 0) {return []}

  const rows = await prisma.localReleaseTrack.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      artist: true,
      albumArtist: true,
      album: true,
      duration: true,
      localReleaseId: true,
      localRelease: { select: { image: true, imageUrl: true } },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))

  // `ids` is already random; keep that order.
  return ids.flatMap((id) => {
    const t = byId.get(id)
    if (!t) {return []}
    const img = verifyImage(t.localRelease?.image, t.localRelease?.imageUrl, 'releases')
    return [{
      id: t.id,
      title: t.title || 'Unknown',
      artist: t.artist || t.albumArtist || 'Unknown',
      album: t.album || 'Unknown',
      duration: t.duration || 0,
      artistSlug: slug,
      releaseImage: img.image,
      releaseImageUrl: img.imageUrl,
      localReleaseId: t.localReleaseId,
    }]
  })
})
