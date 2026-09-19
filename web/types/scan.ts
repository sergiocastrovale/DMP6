export interface AutoScanSettings {
  enabled: boolean
  intervalHours: number
  lastRunAt: Date | null
}

export interface CapturedRun {
  command: string
  args: string[]
}

export interface ScanProgress {
  phase: 'index' | 'sync' | 'tidy'
  folder?: string
  artist?: string
  step?: string
  current: number
  total: number
}

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

// GET /api/terminal/sessions - every live, reconnectable DMP tmux session (see
// server/utils/tmuxSessions.ts), used by stores/terminal.ts's autoReconnectOrphan() for cross-page/
// cross-reload recovery.
export interface TerminalSessionSummary {
  session: string
  startedAt: string | null
}

export interface TerminalSessionsResponse {
  sessions: TerminalSessionSummary[]
}
