import { spawn } from 'child_process'
import { existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { getMosaicProcess, setMosaicProcess } from '~/server/utils/mosaic'
import { prisma } from '~/server/utils/prisma'

const VALID_MODES = ['chronological', 'gradient', 'random']

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  if (getMosaicProcess()) {
    throw createError({ statusCode: 409, message: 'Mosaic generation already in progress' })
  }

  const body = await readBody<{ mode?: string }>(event).catch(() => ({}))
  const mode = VALID_MODES.includes(body.mode || '') ? body.mode! : 'chronological'

  const { remoteServerUrl } = useRuntimeConfig()

  if (remoteServerUrl) {
    return proxyToRemote(event, remoteServerUrl, mode)
  }

  const { imageDir } = useRuntimeConfig()
  const workDir = process.env.PROJECT_ROOT || process.cwd()
  const absImageDir = resolve(imageDir)
  const sourceDir = join(absImageDir, 'releases')
  const outputDir = join(absImageDir, 'labs')

  const candidates = [
    join(workDir, 'mosaic'),
    join(workDir, '..', 'mosaic'),
    'mosaic',
  ]
  const binaryPath = candidates.find((p) => p === 'mosaic' || existsSync(p))!

  const releases = await prisma.$queryRaw<{ image: string; year: number | null }[]>`
    SELECT DISTINCT ON (
      CASE WHEN "groupKey" LIKE 'mb:%' THEN split_part("groupKey", ':', 2)
           ELSE "groupKey"
      END
    ) image, year
    FROM "LocalRelease"
    WHERE image IS NOT NULL
    ORDER BY
      CASE WHEN "groupKey" LIKE 'mb:%' THEN split_part("groupKey", ':', 2)
           ELSE "groupKey"
      END,
      "createdAt" ASC
  `

  const manifestPath = join(tmpdir(), `mosaic-manifest-${Date.now()}.json`)
  writeFileSync(manifestPath, JSON.stringify(
    releases.map((r) => ({ file: r.image, year: r.year ?? 9999 })),
  ))

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  return new Promise<void>((resolve_) => {
    const child = spawn(
      binaryPath,
      ['--image-dir', sourceDir, '--output-dir', outputDir, '--mode', mode, '--manifest', manifestPath, '--web'],
      { cwd: workDir },
    )
    setMosaicProcess(child)

    const cleanup = () => {
      try { unlinkSync(manifestPath) } catch {}
    }

    child.on('error', (err) => {
      setMosaicProcess(null)
      cleanup()
      res.write(`data: ${JSON.stringify(`Error: ${err.message}`)}\n\n`)
      res.write(`event: done\ndata: 1\n\n`)
      res.end()
      resolve_()
    })

    let buffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        if (!line) { continue }
        if (line.startsWith('PROGRESS:')) {
          res.write(`event: progress\ndata: ${line.slice(9)}\n\n`)
        } else if (line.startsWith('DONE:')) {
          res.write(`event: result\ndata: ${line.slice(5)}\n\n`)
        } else {
          res.write(`data: ${JSON.stringify(line)}\n\n`)
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) {
        res.write(`data: ${JSON.stringify(text)}\n\n`)
      }
    })

    child.on('close', (code) => {
      setMosaicProcess(null)
      cleanup()
      res.write(`event: done\ndata: ${code ?? 0}\n\n`)
      res.end()
      resolve_()
    })

    event.node.req.on('close', () => {
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

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res
  const reader = response.body.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { break }
      res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}
