import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { getMosaicProcess, setMosaicProcess } from '~/server/utils/mosaic'
import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { projectRoot, scriptPath } from '~/server/utils/runScript'
import { fetchMosaicSources } from '~/server/utils/mosaicSource'
import { openSse } from '~/server/utils/sse'
import { readBodyOf } from '~/server/utils/requestValidation'
import { mosaicBodySchema } from '~/server/schemas/labs'

export default defineEventHandler(async (event) => {
  // Mosaic generation is a heavyweight, single-global-slot child process (409 if one's already
  // running) - a VIEWER shouldn't be able to hog or repeatedly kill it for everyone else. No dedicated
  // permission key exists for labs (adding one means a RolePermission backfill this session can't run
  // against the real NAS DB - see docs' "TO DO / VERIFY WHEN NAS IS ONLINE"), so this uses the simpler
  // role check instead, matching other ADMIN/MANAGER-gated actions that don't need a DB-backed
  // permission row (audit #94).
  await requirePermission(event, 'labs.mosaic')

  if (getMosaicProcess()) {
    throw createError({ statusCode: 409, message: 'Mosaic generation already in progress' })
  }

  const { mode } = await readBodyOf(event, mosaicBodySchema)

  const { remoteServerUrl } = useRuntimeConfig()

  if (remoteServerUrl) {
    return proxyToRemote(event, remoteServerUrl, mode)
  }

  const { imageDir } = useRuntimeConfig()
  const workDir = projectRoot()
  const absImageDir = resolve(imageDir)
  const sourceDir = join(absImageDir, 'releases')
  const outputDir = join(absImageDir, 'labs')

  const binaryPath = scriptPath('mosaic')

  const releases = await fetchMosaicSources()

  const manifestPath = join(tmpdir(), `mosaic-manifest-${Date.now()}.json`)
  writeFileSync(manifestPath, JSON.stringify(
    releases.map((r) => ({ file: r.image, year: r.year ?? 9999 })),
  ))

  const sse = openSse(event)

  return new Promise<void>((resolve_) => {
    const child = spawn(
      binaryPath,
      ['--image-dir', sourceDir, '--output-dir', outputDir, '--mode', mode, '--manifest', manifestPath, '--web'],
      { cwd: workDir },
    )
    setMosaicProcess(child)

    const cleanup = () => {
      try { unlinkSync(manifestPath) } catch { /* ignore */ }
    }

    // The stream ignores writes once the client is gone, but the child's own 'close'/stdout/stderr events can still
    // fire afterward: this stops the bookkeeping (process slot, manifest) from running twice (audit #94).
    let done = false

    child.on('error', (err) => {
      if (done) {return}
      done = true
      setMosaicProcess(null)
      cleanup()
      sse.send(`Error: ${err.message}`)
      sse.done(1)
      resolve_()
    })

    let buffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      if (done) {return}
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        if (!line) { continue }
        if (line.startsWith('PROGRESS:')) {
          sse.sendEvent('progress', line.slice(9))
        } else if (line.startsWith('DONE:')) {
          sse.sendEvent('result', line.slice(5))
        } else {
          sse.send(line)
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (done) {return}
      const text = chunk.toString().trim()
      if (text) {
        sse.send(text)
      }
    })

    child.on('close', (code) => {
      if (done) {return}
      done = true
      setMosaicProcess(null)
      cleanup()
      sse.done(code ?? 0)
      resolve_()
    })

    sse.onClose(() => {
      if (done) {return}
      done = true
      if (getMosaicProcess() === child) {
        child.kill('SIGTERM')
        setMosaicProcess(null)
      }
      cleanup()
      resolve_()
    })
  })
})

async function proxyToRemote(event: any, remoteServerUrl: string, mode: string) {
  const cookie = getRequestHeader(event, 'cookie') || ''
  const remoteUrl = `${remoteServerUrl}/api/labs/mosaic/generate`

  const response = await fetch(remoteUrl, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })

  if (!response.ok || !response.body) {
    throw createError({ statusCode: response.status, message: 'Remote generation failed' })
  }

  const sse = openSse(event, { heartbeatMs: 0 })
  const reader = response.body.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { break }
      sse.raw(Buffer.from(value))
    }
  } finally {
    event.node.res.end()
  }
}
