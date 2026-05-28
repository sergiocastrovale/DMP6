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
