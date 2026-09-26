import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { invalidateShared } from '~/server/utils/cache'
import { verifyImage, forgetImageExists } from '~/server/utils/images'

// Called by useArtistPage's fetchPhoto() right after `./artist-photos --id <id>` exits 0 - that
// script writes straight to Postgres/disk and can't reach Redis or this process's own 60s
// exists-on-disk cache, so both need busting here before the page can trust a fresh read.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { image: true, imageUrl: true },
  })
  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  forgetImageExists('artists', artist.image)
  await invalidateShared(`artist:${slug}`)
  await invalidateShared('artists:*')

  return verifyImage(artist.image, artist.imageUrl, 'artists')
})
