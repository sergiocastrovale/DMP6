import { statfs } from 'node:fs/promises'
import { prisma } from '~/server/utils/prisma'
import { monitorLog } from '~/server/utils/monitorLog'

export type PauseReason = 'manual' | 'disk-full'

/** Free space (GB) under a path; -1 if unavailable (never block on a stat error). */
export const freeGb = async (path: string): Promise<number> => {
  try {
    const s = await statfs(path)
    return (Number(s.bavail) * Number(s.bsize)) / 1e9
  }
  catch { return -1 }
}

export const getPauseState = async (): Promise<{ paused: boolean; reason: string | null }> => {
  const s = await prisma.settings.findUnique({ where: { id: 'main' }, select: { downloadsPaused: true, downloadsPausedReason: true } })
  return { paused: s?.downloadsPaused ?? false, reason: s?.downloadsPausedReason ?? null }
}

export const isDownloadsPaused = async (): Promise<boolean> => (await getPauseState()).paused

export const setDownloadsPaused = async (paused: boolean, reason: PauseReason | null): Promise<void> => {
  await prisma.settings.update({
    where: { id: 'main' },
    data: { downloadsPaused: paused, downloadsPausedReason: paused ? reason : null },
  }).catch(() => {})
}

/**
 * Auto-pause when the downloads volume drops below the free-space floor. Idempotent + logs once on the
 * transition. Returns whether downloads are paused (for any reason) after the check.
 */
export const enforceDiskGuard = async (downloadsPath: string, minFreeGb: number): Promise<boolean> => {
  const free = await freeGb(downloadsPath)
  const { paused } = await getPauseState()
  if (free >= 0 && free < minFreeGb) {
    if (!paused) {
      await setDownloadsPaused(true, 'disk-full')
      monitorLog('warn', `disk full: ${free.toFixed(1)}GB free (< ${minFreeGb}GB) — auto-paused downloads`)
    }
    return true
  }
  return paused
}
