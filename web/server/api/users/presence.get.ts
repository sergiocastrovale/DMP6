import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { verifyImage } from '~/server/utils/images'
import { listOnline, isStillPlaying } from '~/server/utils/presence'
import type { UserPresence } from '~/types/auth'

// Settings → Users "connected now" panel, polled every USERS_LIVE_REFRESH_MS
// (components/settings/UsersLive.vue). Track/release/artist details are resolved from the DB by id -
// never trust the client-submitted title/artist strings a heartbeat carried (server/api/me/presence.post.ts).
export default defineEventHandler(async (event): Promise<UserPresence[]> => {
  await requirePermission(event, 'users.manage')

  const now = Date.now()
  const entries = listOnline(now)
  if (entries.length === 0) {return []}

  const userIds = [...new Set(entries.map(e => e.userId))]
  const trackIds = [...new Set(entries.map(e => e.track?.trackId).filter((id): id is string => !!id))]

  const [users, tracks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    trackIds.length > 0
      ? prisma.localReleaseTrack.findMany({
          where: { id: { in: trackIds } },
          select: {
            id: true,
            title: true,
            localRelease: {
              select: {
                id: true,
                title: true,
                image: true,
                imageUrl: true,
                artists: { select: { artist: { select: { name: true, slug: true } } } },
              },
            },
          },
        })
      : [],
  ])

  const usersById = new Map(users.map(u => [u.id, u]))
  const tracksById = new Map(tracks.map(t => [t.id, t]))

  const byUser = new Map<number, UserPresence>()
  for (const entry of entries) {
    const user = usersById.get(entry.userId)
    if (!user) {continue}

    let nowPlaying: UserPresence['sessions'][number]['nowPlaying'] = null
    if (entry.track) {
      const track = tracksById.get(entry.track.trackId)
      if (track) {
        const release = track.localRelease
        const img = verifyImage(release?.image, release?.imageUrl, 'releases')
        nowPlaying = {
          trackId: track.id,
          title: track.title || 'Unknown',
          album: release?.title ?? null,
          releaseId: release?.id ?? null,
          artist: release?.artists[0]?.artist?.name ?? null,
          artistSlug: release?.artists[0]?.artist?.slug ?? null,
          image: img.image,
          imageUrl: img.imageUrl,
          playing: isStillPlaying(entry.track, now),
        }
      }
    }

    const bucket = byUser.get(entry.userId) ?? { userId: entry.userId, username: user.username, sessions: [] }
    bucket.sessions.push({
      clientId: entry.clientId,
      client: entry.client,
      clientLabel: entry.clientLabel,
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      nowPlaying,
    })
    byUser.set(entry.userId, bucket)
  }

  return [...byUser.values()]
})
