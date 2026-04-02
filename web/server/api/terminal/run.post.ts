import { spawn } from 'child_process'
import path from 'path'

const ALLOWED_COMMANDS = ['./sync', './analysis', './clean', './nuke']

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

export default defineEventHandler(async (event) => {
  const { command, args = [] } = await readBody<{ command: string; args: string[] }>(event)

  if (!ALLOWED_COMMANDS.includes(command)) {
    throw createError({ statusCode: 400, message: `Command not allowed: ${command}` })
  }

  const projectRoot = path.resolve(process.cwd(), '..')

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  return new Promise<void>((resolve) => {
    const proc = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    })

    const send = (text: string) => {
      const clean = stripAnsi(text)
      for (const line of clean.split('\n')) {
        if (line) res.write(`data: ${JSON.stringify(line)}\n\n`)
      }
    }

    proc.stdout.on('data', (chunk: Buffer) => send(chunk.toString()))
    proc.stderr.on('data', (chunk: Buffer) => send(chunk.toString()))

    proc.on('close', (code) => {
      res.write(`event: done\ndata: ${code ?? 1}\n\n`)
      res.end()
      resolve()
    })

    proc.on('error', (err) => {
      send(`Error: ${err.message}`)
      res.write(`event: done\ndata: 1\n\n`)
      res.end()
      resolve()
    })

    event.node.req.on('close', () => {
      proc.kill('SIGTERM')
      resolve()
    })
  })
})
