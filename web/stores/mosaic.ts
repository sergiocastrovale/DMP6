import { defineStore } from 'pinia'
import type { MosaicItem, MosaicProgress } from '~/types/labs'
import { parseSseEvents } from '~/helpers/sse'

export const useMosaicStore = defineStore('mosaic', () => {
  const isGenerating = ref(false)
  const progress = ref<MosaicProgress | null>(null)
  const mosaics = ref<MosaicItem[]>([])
  const error = ref<string | null>(null)
  const lastResult = ref<{ full: string; preview: string } | null>(null)

  let abortController: AbortController | null = null

  const loadMosaics = async () => {
    mosaics.value = await $fetch<MosaicItem[]>('/api/labs/mosaic/list')
  }

  const generate = async (mode: string = 'chronological') => {
    if (isGenerating.value) { return }

    isGenerating.value = true
    progress.value = null
    error.value = null
    lastResult.value = null
    abortController = new AbortController()

    try {
      const response = await fetch('/api/labs/mosaic/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        error.value = `Error: ${response.status} ${response.statusText}`
        isGenerating.value = false
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) { break }

        buffer += decoder.decode(value, { stream: true })
        const { events, remainder } = parseSseEvents(buffer)
        buffer = remainder

        for (const { event: eventType, data } of events) {
          if (eventType === 'progress') {
            try { progress.value = JSON.parse(data) } catch { /* ignore */ }
          } else if (eventType === 'result') {
            try { lastResult.value = JSON.parse(data) } catch { /* ignore */ }
            await loadMosaics()
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        error.value = e.message
      }
    } finally {
      isGenerating.value = false
      progress.value = null
      abortController = null
      await loadMosaics()
    }
  }

  const cancel = async () => {
    abortController?.abort()
    await fetch('/api/labs/mosaic/cancel', { method: 'POST' })
    isGenerating.value = false
    progress.value = null
  }

  const deleteMosaic = async (filename: string) => {
    await $fetch(`/api/labs/mosaic/${filename}`, { method: 'DELETE' })
    mosaics.value = mosaics.value.filter((m) => m.filename !== filename)
  }

  return { isGenerating, progress, mosaics, error, lastResult, loadMosaics, generate, cancel, deleteMosaic }
})
