<script setup lang="ts">
import { Loader2, Download, CheckCircle, AlertCircle, Search } from 'lucide-vue-next'
import type { DownloadSource, SearchResult } from '~/types/download'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'

const props = defineProps<{
  modelValue: boolean
  releaseTitle: string
  artistName: string
  releaseYear?: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const downloads = useDownloadsStore()
const terminal = useTerminalStore()

const searchQuery = ref(`${props.artistName} ${props.releaseTitle}`)
const source = ref<DownloadSource>(
  downloads.slskd.connected ? 'slskd'
    : downloads.hifi.connected ? 'hifi'
      : 'deezer',
)
const searching = ref(false)
const results = ref<SearchResult[]>([])
const downloadStarted = ref(false)
const downloadError = ref('')
const slskdSearchId = ref<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  doSearch()
})

watch(source, () => {
  doSearch()
})

onUnmounted(() => {
  stopPolling()
  // Clean up slskd search
  if (slskdSearchId.value) {
    $fetch(`/api/downloads/search/${slskdSearchId.value}`, { method: 'DELETE' }).catch(() => {})
  }
})

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function doSearch() {
  searching.value = true
  results.value = []
  downloadStarted.value = false
  downloadError.value = ''
  stopPolling()

  try {
    const data = await $fetch<any>('/api/downloads/search', {
      method: 'POST',
      body: { query: searchQuery.value, source: source.value, artist: props.artistName },
    })

    if (source.value === 'deezer' || source.value === 'hifi') {
      results.value = data.results || []
      searching.value = false
    }
    else if (source.value === 'slskd') {
      slskdSearchId.value = data.searchId
      // Poll for results every 2s, up to 15 polls (30s)
      let polls = 0
      pollTimer = setInterval(async () => {
        polls++
        try {
          const pollData = await $fetch<any>(`/api/downloads/search/${slskdSearchId.value}`)
          results.value = pollData.results || []
          if (polls >= 15 || results.value.length >= 20) {
            stopPolling()
            searching.value = false
          }
        }
        catch {
          stopPolling()
          searching.value = false
        }
      }, 2000)
    }
  }
  catch (e: any) {
    downloadError.value = e.data?.message || e.message || 'Search failed'
    searching.value = false
  }
}

function startDownload(result: SearchResult) {
  // Close dialog and open terminal panel with SSE stream
  stopPolling()
  emit('update:modelValue', false)

  const dlSource = result.source
  const query = searchQuery.value
  terminal.runDownload(dlSource, query, props.releaseTitle, props.artistName, props.releaseYear ?? null)
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return ''
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
}

const formatBadgeClass = (format: string) => {
  if (format === 'FLAC') return 'bg-emerald-500/20 text-emerald-400'
  if (format.includes('MP3') || format === 'MP3 320') return 'bg-blue-500/20 text-blue-400'
  return 'bg-ink0/20 text-ink-2'
}
</script>

<template>
  <Dialog :model-value="modelValue" :title="`Download: ${releaseTitle}`" max-width="lg" @update:model-value="emit('update:modelValue', $event)">
    <!-- Download started confirmation -->
    <div v-if="downloadStarted" class="flex flex-col items-center gap-3 py-8">
      <CheckCircle :size="32" class="text-emerald-500" />
      <p class="text-sm text-ink-2">Download started</p>
    </div>

    <template v-else>
      <!-- Search controls -->
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <div class="flex rounded-lg border border-rule bg-bg-2 text-sm">
          <button
            v-if="downloads.slskd.connected"
            class="rounded-l-lg px-3 py-1.5 transition-colors"
            :class="source === 'slskd' ? 'bg-bg-3 text-ink' : 'text-ink-2 hover:text-ink'"
            @click="source = 'slskd'"
          >
            Soulseek
          </button>
          <button
            v-if="downloads.hifi.connected"
            class="px-3 py-1.5 transition-colors"
            :class="[
              source === 'hifi' ? 'bg-bg-3 text-ink' : 'text-ink-2 hover:text-ink',
              !downloads.slskd.connected ? 'rounded-l-lg' : '',
            ]"
            @click="source = 'hifi'"
          >
            HiFi
          </button>
          <button
            v-if="downloads.deezer.connected"
            class="rounded-r-lg px-3 py-1.5 transition-colors"
            :class="source === 'deezer' ? 'bg-bg-3 text-ink' : 'text-ink-2 hover:text-ink'"
            @click="source = 'deezer'"
          >
            Deezer
          </button>
        </div>

        <div class="flex flex-1 items-center gap-1.5 rounded-lg border border-rule bg-bg-2 px-3 py-1.5">
          <Search :size="14" class="shrink-0 text-ink0" />
          <input
            v-model="searchQuery"
            class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink0"
            placeholder="Search query..."
            @keydown.enter="doSearch"
          />
        </div>

        <button
          class="rounded-lg border border-rule bg-bg-2 px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-bg-3"
          :disabled="searching"
          @click="doSearch"
        >
          Search
        </button>
      </div>

      <!-- Error -->
      <div v-if="downloadError" class="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
        <AlertCircle :size="14" class="shrink-0 text-red-400" />
        <p class="text-xs text-red-400">{{ downloadError }}</p>
      </div>

      <!-- Searching -->
      <div v-if="searching && results.length === 0" class="flex flex-col items-center gap-3 py-8">
        <Loader2 :size="24" class="animate-spin text-ink0" />
        <p class="text-sm text-ink-2">
          Searching {{ source === 'slskd' ? 'Soulseek' : 'Deezer' }}...
        </p>
      </div>

      <!-- Results -->
      <div v-else-if="results.length > 0" class="flex flex-col gap-1">
        <p v-if="searching" class="mb-2 text-xs text-ink0">
          <Loader2 :size="12" class="mr-1 inline animate-spin" />
          Still searching... {{ results.length }} results so far
        </p>

        <div class="max-h-[400px] overflow-y-auto">
          <div
            v-for="result in results"
            :key="result.id"
            class="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-2"
          >
            <span
              class="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              :class="formatBadgeClass(result.format)"
            >
              {{ result.format }}
            </span>

            <div class="min-w-0 flex-1">
              <div class="truncate text-sm text-ink-2">
                {{ result.folderPath.split('/').pop() || result.folderPath }}
              </div>
              <div class="flex items-center gap-2 text-xs text-ink0">
                <span>{{ result.fileCount }} files</span>
                <span v-if="result.totalSize">{{ formatSize(result.totalSize) }}</span>
                <span v-if="result.avgBitrate">{{ result.avgBitrate }}kbps</span>
                <span v-if="result.source === 'slskd'" class="text-ink-4">{{ result.username }}</span>
                <span v-if="result.uploadSpeed" class="text-ink-4">{{ formatSpeed(result.uploadSpeed) }}</span>
                <span v-if="result.queueLength" class="text-ink-4">Q:{{ result.queueLength }}</span>
              </div>
            </div>

            <span class="shrink-0 text-xs font-medium text-ink0">{{ result.score }}</span>

            <button
              class="shrink-0 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-all hover:bg-accent/20"
              @click="startDownload(result)"
            >
              <Download :size="12" class="mr-1 inline" />
              Download
            </button>
          </div>
        </div>
      </div>

      <!-- No results -->
      <div v-else-if="!searching" class="py-8 text-center text-sm text-ink0">
        No results found. Try adjusting your search query.
      </div>
    </template>
  </Dialog>
</template>
