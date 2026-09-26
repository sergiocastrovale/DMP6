import { readFileSync } from 'node:fs'
import type { H3Event } from 'h3'
import { requirePermission, requireRole } from '~/server/utils/permissions'
import {
  gateForTerminalAction,
  parseTerminalRunMeta,
  terminalRunMetaPath,
  type TerminalAction,
  type TerminalGate,
  type TerminalRunMeta,
} from '~/server/utils/terminalAccess'

export const readTerminalRunMeta = (session: string): TerminalRunMeta | null => {
  try {
    return parseTerminalRunMeta(readFileSync(terminalRunMetaPath(session), 'utf8'))
  }
  catch {
    return null
  }
}

export const enforceTerminalGate = async (event: H3Event, gate: TerminalGate): Promise<void> => {
  if (gate.kind === 'role') {
    requireRole(event, gate.role)
    return
  }
  await requirePermission(event, gate.key)
}

export const requireTerminalAccess = async (event: H3Event, action: TerminalAction, session?: string): Promise<void> => {
  const run = action === 'stop' && session ? readTerminalRunMeta(session) : null
  await enforceTerminalGate(event, gateForTerminalAction(action, run))
}
