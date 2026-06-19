import { defineStore } from 'pinia'
import { useGlobalStore } from '~/stores/global'

export const useTerminalStore = defineStore('terminal', () => {
  const isOpen = ref(false)
  const isRunning = ref(false)
  const lines = ref<string[]>([])
  const exitCode = ref<number | null>(null)
  const currentSession = ref<string | null>(null)
  const currentCommand = ref<string | null>(null)

  const hasBackground = computed(() => isRunning.value && !isOpen.value)

  let abortController: AbortController | null = null

  async function streamSSE(url: string, body: Record<string, any>) {
    lines.value = []
    exitCode.value = null
    isRunning.value = true
    isOpen.value = true

    abortController = new AbortController()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        lines.value.push(`Error: ${response.status} ${response.statusText}`)
        isRunning.value = false
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()!

        for (const part of parts) {
          let eventType = 'message'
          let data = ''

          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            else if (line.startsWith('data: ')) data = line.slice(6)
          }

          if (eventType === 'done') {
            exitCode.value = parseInt(data) || 0
          } else if (data) {
            let text: string
            try {
              text = JSON.parse(data)
            } catch {
              text = data
            }
            if (typeof text === 'string' && text.startsWith('\r')) {
              const cleaned = text.slice(1)
              if (lines.value.length > 0 && lines.value[lines.value.length - 1]!.startsWith('\r')) {
                lines.value[lines.value.length - 1] = '\r' + cleaned
              } else {
                lines.value.push('\r' + cleaned)
              }
            } else {
              lines.value.push(text)
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        lines.value.push(`Error: ${e.message}`)
      }
    } finally {
      isRunning.value = false
      currentSession.value = null
      currentCommand.value = null
      abortController = null
      useGlobalStore().refresh()
    }
  }

  async function run(command: string, args: string[], session?: string) {
    const resolvedSession = session ?? `dmp-${command.replace('./', '')}`
    currentSession.value = resolvedSession
    currentCommand.value = command
    return streamSSE('/api/terminal/run', { command, args, session: resolvedSession })
  }

  async function reconnect(session: string) {
    currentSession.value = session
    return streamSSE('/api/terminal/reconnect', { session })
  }

  // Generic SSE streamer for non-script operations (e.g. merge) that want their output in the terminal.
  async function runStream(url: string, body: Record<string, any>, session: string, label: string) {
    currentSession.value = session
    currentCommand.value = label
    return streamSSE(url, body)
  }

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  async function stop() {
    if (currentSession.value) {
      try {
        await fetch('/api/terminal/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: currentSession.value }),
        })
      }
      catch { /* best-effort - abort SSE regardless */ }
    }
    abortController?.abort()
    await unlock()
  }

  const hasLockError = computed(() =>
    !isRunning.value
    && exitCode.value !== null
    && exitCode.value !== 0
    && lines.value.some(l => typeof l === 'string' && l.includes('lock held')),
  )

  async function unlock() {
    try {
      await fetch('/api/terminal/unlock', { method: 'POST' })
      lines.value.push('Lock cleared.')
    }
    catch {
      lines.value.push('Failed to clear lock.')
    }
  }

  return { isOpen, isRunning, lines, exitCode, currentSession, currentCommand, hasBackground, hasLockError, run, runStream, reconnect, open, close, stop, unlock }
})
