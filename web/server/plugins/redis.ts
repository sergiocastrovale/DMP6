import { redis } from '~/server/utils/redis'

// The client is lazy with no offline queue, so without an explicit connect the first command after boot fails
// (a guaranteed cache miss). A Redis that is down at boot is fine: every cache call already tolerates it.
export default defineNitroPlugin(() => {
  redis?.connect().catch(() => {})
})
