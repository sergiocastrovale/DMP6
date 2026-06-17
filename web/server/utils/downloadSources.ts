import type { DownloadSource } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

// The DownloadSources config rows + the source-routing rule. RuTracker is tried first (higher priority
// band); Soulseek is the fallback. A source with retry=false is never re-searched for a release once it
// has missed (recorded in DownloadedRelease.triedSources).

// Priority bands that drive source routing. Fresh picks enter at RT_PRIORITY and are tried on RuTracker
// first; an RT miss drops them to the SLSK band so they fall through to Soulseek. "Drain RT first"
// emerges naturally because the retry pool is ordered by priority DESC.
export const RT_PRIORITY = 10
export const SLSK_PRIORITY = 5

export interface SourceConfig {
  name: 'SLSKD' | 'RUTRACKER'
  url: string | null
  retry: boolean
  enabled: boolean
}

const DEFAULTS: SourceConfig[] = [
  { name: 'RUTRACKER', url: 'https://rutracker.org', retry: false, enabled: true },
  { name: 'SLSKD', url: null, retry: true, enabled: true },
]

let cache: SourceConfig[] | null = null
let cacheAt = 0
const TTL = 15_000

// Idempotently create the two source rows (called on first read + at plugin startup + by the seed).
export async function ensureDownloadSources(): Promise<void> {
  for (const d of DEFAULTS) {
    await prisma.downloadSourceConfig.upsert({
      where: { name: d.name },
      create: { name: d.name, url: d.url, retry: d.retry, enabled: d.enabled },
      update: {},
    })
  }
}

export async function getDownloadSources(): Promise<SourceConfig[]> {
  if (cache && Date.now() - cacheAt < TTL) return cache
  let rows = await prisma.downloadSourceConfig.findMany().catch(() => [])
  if (rows.length === 0) {
    await ensureDownloadSources().catch(() => {})
    rows = await prisma.downloadSourceConfig.findMany().catch(() => [])
  }
  cache = (rows.length ? rows : DEFAULTS).map(r => ({
    name: r.name as SourceConfig['name'], url: r.url ?? null, retry: r.retry, enabled: r.enabled,
  }))
  cacheAt = Date.now()
  return cache
}

export function invalidateDownloadSourcesCache(): void {
  cache = null
  cacheAt = 0
}

const find = (configs: SourceConfig[], name: SourceConfig['name']) => configs.find(c => c.name === name)

/**
 * Pick the source to use for a release given its current priority + the sources it has already
 * exhausted (no-retry misses). RuTracker first (when enabled, not exhausted, and still in its priority
 * band); Soulseek otherwise. Returns null when nothing is eligible (e.g. both sources disabled).
 */
export function chooseSource(
  priority: number,
  triedSources: DownloadSource[],
  configs: SourceConfig[],
): 'RUTRACKER' | 'SLSKD' | null {
  const rt = find(configs, 'RUTRACKER')
  const slsk = find(configs, 'SLSKD')
  if (rt?.enabled && !triedSources.includes('RUTRACKER') && priority > SLSK_PRIORITY) return 'RUTRACKER'
  if (slsk?.enabled) return 'SLSKD'
  return null
}
