import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { searchArtists, getArtistByMbid } from '~/server/utils/musicbrainz'
import { MBID_REGEX } from '~/helpers/constants'

// Search MusicBrainz for artists (first page only, no search-while-typing - the /add page's Search
// button triggers this). Flags rows already in the library so the table can show an "In library" chip
// without a second round trip per row. A pasted MBID skips the name search and looks the artist up
// directly - `/artist?query=<uuid>` doesn't reliably match on id.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  const q = (getQuery(event).q as string || '').trim()
  if (!q) {
    return { items: [] }
  }

  const byMbid = MBID_REGEX.test(q) ? await getArtistByMbid(q) : null
  const results = byMbid ? [byMbid] : MBID_REGEX.test(q) ? [] : await searchArtists(q)
  if (results.length === 0) {
    return { items: [] }
  }

  const mbids = results.map(r => r.mbid)
  const existingRows = await prisma.artist.findMany({
    where: { musicbrainzId: { in: mbids } },
    select: { musicbrainzId: true, slug: true, name: true, primaryArtist: { select: { slug: true, name: true } } },
  })
  const existingByMbid = new Map(
    existingRows.map(a => [a.musicbrainzId!, a.primaryArtist ?? { slug: a.slug, name: a.name }]),
  )

  return {
    items: results.map(r => ({
      ...r,
      existing: existingByMbid.get(r.mbid) ?? null,
    })),
  }
})
