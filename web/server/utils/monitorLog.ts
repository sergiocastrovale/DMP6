import { appendFile, mkdir, stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { MonitorLevel } from '~/types/download'
import { prisma } from '~/server/utils/prisma'

// Single sink for the whole monitoring workflow (plugin tick, reconcile, top-up, gaps, auto-merge,
// move/transcode/layout, pause guard). Every line is `[{timestamp}][{type}] {message}` and is both
// mirrored to the container stdout/stderr (so `docker logs` still works) and appended to monitor.log
// under the mounted data dir (NOT the project root - that isn't a persistent volume and was growing
// unbounded).
const logDir = process.env.LOG_DIR || join(process.env.PROJECT_ROOT || process.cwd(), 'data', 'logs')
const logPath = join(logDir, 'monitor.log')
const MAX_LOG_BYTES = 10 * 1024 * 1024 // 10MB, then rotate to monitor.log.1 (single previous file kept)

let dirEnsured = false
const ensureLogDir = async (): Promise<void> => {
  if (dirEnsured) { return }
  await mkdir(logDir, { recursive: true }).catch(() => {})
  dirEnsured = true
}

const rotateIfNeeded = async (): Promise<void> => {
  const size = await stat(logPath).then(s => s.size).catch(() => 0)
  if (size < MAX_LOG_BYTES) { return }
  await rename(logPath, `${logPath}.1`).catch(() => {})
}

export const monitorLog = (level: MonitorLevel, msg: string): void => {
  const line = `[${new Date().toISOString()}][${level}] ${msg}`
  if (level === 'error') {
    console.error(line)
  }
  else {
    console.log(line)
  }
  ensureLogDir()
    .then(() => rotateIfNeeded())
    .then(() => appendFile(logPath, `${line}\n`))
    .catch(() => {})
  // Persist issues (not routine notices) to the shared DB so the UI can surface them cross-instance.
  if (level !== 'notice') {
    prisma.monitorEvent.create({ data: { level, message: msg } }).catch(() => {})
  }
}
