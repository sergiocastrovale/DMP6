import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'

export type MonitorLevel = 'error' | 'warn' | 'notice'

// Single sink for the whole monitoring workflow (plugin tick, reconcile, top-up, gaps, auto-merge,
// move/transcode/layout, pause guard). Every line is `[{timestamp}][{type}] {message}` and is both
// mirrored to the container stdout/stderr (so `docker logs` still works) and appended to monitor.log
// at the project root.
const logPath = join(process.env.PROJECT_ROOT || process.cwd(), 'monitor.log')

export const monitorLog = (level: MonitorLevel, msg: string): void => {
  const line = `[${new Date().toISOString()}][${level}] ${msg}`
  if (level === 'error') {
    console.error(line)
  }
  else {
    console.log(line)
  }
  appendFile(logPath, `${line}\n`).catch(() => {})
  // Persist issues (not routine notices) to the shared DB so the UI can surface them cross-instance.
  if (level !== 'notice') {
    prisma.monitorEvent.create({ data: { level, message: msg } }).catch(() => {})
  }
}
