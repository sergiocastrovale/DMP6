export const HEALTH_PROBE_TIMEOUT_MS = 1_000

export interface HealthDeps {
  pingDatabase: () => Promise<unknown>
  // Absent when Redis is not configured.
  pingRedis?: () => Promise<unknown>
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health probe timed out')), ms)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })

// Whether the app can do its job: the database answers. Redis is a cache the app is built to work without (every call
// falls through), so a down Redis must not mark the container unhealthy - it is probed only so a hung connection
// cannot stall the probe, and never changes the verdict.
export const checkHealth = async ({ pingDatabase, pingRedis }: HealthDeps, timeoutMs = HEALTH_PROBE_TIMEOUT_MS): Promise<{ ok: boolean }> => {
  const [database] = await Promise.allSettled([
    withTimeout(pingDatabase(), timeoutMs),
    pingRedis ? withTimeout(pingRedis(), timeoutMs) : Promise.resolve(),
  ])
  return { ok: database.status === 'fulfilled' }
}
