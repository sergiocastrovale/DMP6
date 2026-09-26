import type { TrackCandidate, ExploreParams } from '~/types/player'
import { verifyImage } from '~/server/utils/images'
import {
  scoreTrack, weightedRandomPick,
  getPoolCacheKey, getCachedPool, setCachedPool, removeFromPool,
} from '~/server/utils/explore'
import { fetchExplorePool } from '~/server/utils/exploreCandidates'
import { readBodyOf } from '~/server/utils/requestValidation'
import { exploreBodySchema } from '~/server/schemas/playback'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const { excludeIds, ...params }: { excludeIds: string[] } & ExploreParams = await readBodyOf(event, exploreBodySchema)
  const cacheKey = getPoolCacheKey(userId, params)

  // Try cached pool first
  let candidates: TrackCandidate[]
  const cached = getCachedPool(cacheKey, excludeIds)

  if (cached && cached.length >= 20) {
    candidates = cached
  } else {
    candidates = await fetchExplorePool({ userId, params, excludeIds })
    if (candidates.length === 0) {
      throw createError({ statusCode: 404, message: 'No tracks found' })
    }

    // Cache the full pool for subsequent requests with the same params
    setCachedPool(cacheKey, candidates)
  }

  // Score each track
  const scored = candidates.map(track => ({
    track,
    score: scoreTrack(track, params),
  }))

  // Weighted random pick from top scorers
  const pick = weightedRandomPick(scored)

  if (!pick) {
    throw createError({ statusCode: 404, message: 'No matching tracks found' })
  }

  // Remove picked track from cache so it won't repeat
  removeFromPool(cacheKey, pick.track.id)

  const t = pick.track
  const img = verifyImage(t.localRelease?.image, t.localRelease?.imageUrl, 'releases')
  return {
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    // Already selected above for the era filter; the explore history row shows it under the title.
    year: t.year ?? null,
    artistSlug: t.localRelease?.artists[0]?.artist.slug || null,
    releaseImage: img.image,
    releaseImageUrl: img.imageUrl,
    localReleaseId: t.localReleaseId,
  }
})
