import { prisma } from '~/server/utils/prisma'

export interface ScanStatus {
  isRunning: boolean
  lockedBy: string | null
  lockedAt: string | null
  pid: number | null
  args: string | null
  sessionName: string | null
  lastScanStartedAt: string | null
  lastScanEndedAt: string | null
  lastIndexedFolder: string | null
  lastSyncedArtist: string | null
}

export default defineEventHandler(async (): Promise<ScanStatus> => {
  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: {
      lastScanStartedAt: true,
      lastScanEndedAt: true,
      lastSyncedArtist: true,
      lastIndexedFolder: true,
      scanLockedBy: true,
      scanLockedAt: true,
      scanPid: true,
    },
  })

  const lockedBy = stats?.scanLockedBy ?? null

  return {
    isRunning: !!lockedBy,
    lockedBy,
    lockedAt: stats?.scanLockedAt?.toISOString() ?? null,
    pid: stats?.scanPid ?? null,
    args: null,
    sessionName: lockedBy ? `dmp-${lockedBy}` : null,
    lastScanStartedAt: stats?.lastScanStartedAt?.toISOString() ?? null,
    lastScanEndedAt: stats?.lastScanEndedAt?.toISOString() ?? null,
    lastIndexedFolder: stats?.lastIndexedFolder ?? null,
    lastSyncedArtist: stats?.lastSyncedArtist ?? null,
  }
})
