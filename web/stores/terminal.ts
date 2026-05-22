import { defineStore } from 'pinia'
import type { DownloadSource } from '~/types/download'
import { useGlobalStore } from '~/stores/global'

export const useTerminalStore = defineStore('terminal', () => {
  const isOpen = ref(false)
  const isRunning = ref(false)
  const lines = ref<string[]>([])
  const exitCode = ref<number | null>(null)
  const currentSession = ref<string | null>(null)

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
            try {
              lines.value.push(JSON.parse(data))
            } catch {
              lines.value.push(data)
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
      abortController = null
      useGlobalStore().refresh()
    }
  }

  async function run(command: string, args: string[], session?: string) {
    const resolvedSession = session ?? `dmp-${command.replace('./', '')}`
    currentSession.value = resolvedSession
    return streamSSE('/api/terminal/run', { command, args, session: resolvedSession })
  }

  async function reconnect(session: string) {
    currentSession.value = session
    return streamSSE('/api/terminal/reconnect', { session })
  }

  async function runDownload(
    source: DownloadSource,
    query: string,
    albumTitle?: string,
    artistName?: string,
    year?: number | null,
  ) {
    return streamSSE('/api/downloads/stream', { source, query, albumTitle, artistName, year })
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
      catch { /* best-effort — abort SSE regardless */ }
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

  return { isOpen, isRunning, lines, exitCode, currentSession, hasBackground, hasLockError, run, reconnect, runDownload, open, close, stop, unlock }
})
