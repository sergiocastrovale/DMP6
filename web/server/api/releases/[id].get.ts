import type { AlsoPartOfEntry } from '~/types/release'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { accumulateAlsoPartOf, buildReleaseCard, LOCAL_RELEASE_CARD_SELECT, MB_RELEASE_CARD_SELECT } from '~/server/utils/releaseAggregation'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { releasePlayTotals } from '~/server/utils/userPlays'

export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const lr = await prisma.localRelease.findUnique({
    where: { id },
    select: { ...LOCAL_RELEASE_CARD_SELECT, release: { select: MB_RELEASE_CARD_SELECT } },
  })

  if (!lr) {
    throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  }

  const boxMbr = lr.boxReleaseId
    ? await prisma.musicBrainzRelease.findUnique({ where: { id: lr.boxReleaseId }, select: MB_RELEASE_CARD_SELECT })
    : null

  // docs/sync_decisions.md: box sets in the catalogue that reprint this release's whole release group -
  // a pure catalogue fact, independent of whether this artist owns any copy of them.
  let alsoPartOf: AlsoPartOfEntry[] | undefined
  if (lr.release?.releaseGroupId) {
    const media = await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: lr.release.releaseGroupId },
      select: { equivalentReleaseGroupId: true, releaseId: true, release: { select: { title: true, year: true, releaseGroupId: true } } },
    })
    const byGroupId = new Map<string, AlsoPartOfEntry[]>()
    accumulateAlsoPartOf(media, byGroupId, new Map())
    alsoPartOf = byGroupId.get(lr.release.releaseGroupId)
  }

  const plays = await releasePlayTotals(userId, [lr.id])
  const totalPlayCount = plays.get(lr.id)?.totalPlayCount ?? 0

  return buildReleaseCard({ ...lr, totalPlayCount }, lr.release, verifyImage, { boxMbr, alsoPartOf })
})
