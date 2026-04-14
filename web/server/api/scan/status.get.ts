import { prisma } from '~/server/utils/prisma'

export interface ScanStatus {
  isRunning: boolean
  lockedBy: string | null
  lockedAt: string | null
  pid: number | null
  args: string | null
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
    },
  })

  return {
    isRunning: false,
    lockedBy: null,
    lockedAt: null,
    pid: null,
    args: null,
    lastScanStartedAt: stats?.lastScanStartedAt?.toISOString() ?? null,
    lastScanEndedAt: stats?.lastScanEndedAt?.toISOString() ?? null,
    lastIndexedFolder: null,
    lastSyncedArtist: stats?.lastSyncedArtist ?? null,
  }
})
