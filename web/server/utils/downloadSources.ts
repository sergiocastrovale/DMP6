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

// RuTracker's Prowlarr indexer caps searches per day (default 25). Stay safely under it. Each
// acquireTorrentRelease run performs exactly one Prowlarr /search, so one search == one budget unit.
export const RT_DAILY_BUDGET = Math.max(1, parseInt(process.env.RT_SEARCHES_PER_DAY || '20', 10) || 20)
const DAY_MS = 24 * 60 * 60 * 1000

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

// --- RuTracker daily search budget (persisted, so it survives restarts/deploys) ---

// Read the RUTRACKER row, rolling the 24h window over if it has elapsed. Returns remaining budget.
async function rtBudgetRemaining(): Promise<number> {
  const row = await prisma.downloadSourceConfig.findUnique({ where: { name: 'RUTRACKER' } }).catch(() => null)
  if (!row) return RT_DAILY_BUDGET
  const start = row.budgetWindowStart?.getTime() ?? 0
  if (!start || Date.now() - start >= DAY_MS) return RT_DAILY_BUDGET // window elapsed -> full budget
  return Math.max(0, RT_DAILY_BUDGET - row.budgetUsed)
}

export async function rtBudgetAvailable(): Promise<boolean> {
  return (await rtBudgetRemaining()) > 0
}

// Consume one RuTracker search, rolling the window if it has elapsed. Call right before a Prowlarr search.
export async function consumeRtBudget(): Promise<void> {
  const row = await prisma.downloadSourceConfig.findUnique({ where: { name: 'RUTRACKER' } }).catch(() => null)
  const start = row?.budgetWindowStart?.getTime() ?? 0
  const rolled = !start || Date.now() - start >= DAY_MS
  await prisma.downloadSourceConfig.update({
    where: { name: 'RUTRACKER' },
    data: rolled
      ? { budgetUsed: 1, budgetWindowStart: new Date() }
      : { budgetUsed: { increment: 1 } },
  }).catch(() => {})
}

/**
 * Pick the source to use for a release given its current priority + the sources it has already
 * exhausted (no-retry misses). RuTracker first (when enabled, not exhausted, and still in its priority
 * band); Soulseek otherwise. Returns null when nothing is eligible (e.g. both sources disabled).
 */
export function chooseSource(
  priority: number,
  triedSources: DownloadSource[],
  configs: SourceConfig[],
  rtBudgetOk = true,
): 'RUTRACKER' | 'SLSKD' | null {
  const rt = find(configs, 'RUTRACKER')
  const slsk = find(configs, 'SLSKD')
  // RuTracker first — but only while it has daily search budget left. When the budget is spent we skip
  // RT WITHOUT marking it tried (it wasn't really searched): the release falls through to Soulseek if
  // that's enabled, otherwise nothing happens and it's retried on RuTracker once the budget rolls over.
  if (rt?.enabled && rtBudgetOk && !triedSources.includes('RUTRACKER') && priority > SLSK_PRIORITY) return 'RUTRACKER'
  if (slsk?.enabled) return 'SLSKD'
  return null
}
