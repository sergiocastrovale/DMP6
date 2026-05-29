<script setup lang="ts">
import { CheckCircle, AlertCircle, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-vue-next'
import type { DownloadSearchResult } from '~/types/download'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { formatFileSize, formatSpeed } from '~/helpers/functions'

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
const searching = ref(false)
const results = ref<DownloadSearchResult[]>([])
const downloadStarted = ref(false)
const downloadError = ref('')
const searchId = ref<string | null>(null)
let pollTimer: ReturnType<typeof setTimeout> | null = null

const sortKey = ref<string>('uploadSpeed')
const sortDir = ref<'asc' | 'desc'>('desc')

const dialogTitle = computed(() => `Searching for "${props.releaseTitle}" by ${props.artistName}...`)
const dialogSubtitle = computed(() => 'Using Soulseek via slskd')

const columns = [
  { key: 'format', label: 'Quality', sortable: true },
  { key: 'folderPath', label: 'Title', sortable: true },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'right' as const },
  { key: 'uploadSpeed', label: 'Speed', sortable: true, align: 'right' as const },
]

const toggleSort = (col: typeof columns[number]) => {
  if (!col.sortable) { return }
  if (sortKey.value === col.key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = col.key
    sortDir.value = col.key === 'folderPath' ? 'asc' : 'desc'
  }
}

const sortedResults = computed(() => {
  const arr = [...results.value]
  const key = sortKey.value as keyof DownloadSearchResult
  const dir = sortDir.value === 'asc' ? 1 : -1
  return arr.sort((a, b) => {
    const av = a[key] ?? 0
    const bv = b[key] ?? 0
    if (typeof av === 'string' && typeof bv === 'string') {
      return dir * av.localeCompare(bv)
    }
    return dir * ((av as number) - (bv as number))
  })
})

onMounted(() => {
  doSearch()
})

onUnmounted(() => {
  stopPolling()
  if (searchId.value) {
    $fetch(`/api/downloads/search/${searchId.value}`, { method: 'DELETE' }).catch(() => {})
  }
})

const stopPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

const doSearch = async () => {
  searching.value = true
  results.value = []
  downloadStarted.value = false
  downloadError.value = ''
  stopPolling()

  try {
    const data = await $fetch<any>('/api/downloads/search', {
      method: 'POST',
      body: { query: searchQuery.value, artist: props.artistName },
    })

    searchId.value = data.searchId
    let polls = 0
    const poll = async () => {
      polls++
      try {
        const pollData = await $fetch<any>(`/api/downloads/search/${searchId.value}`)
        results.value = pollData.results || []
        if (polls >= 25 || results.value.length >= 20) {
          stopPolling()
          searching.value = false
          return
        }
      }
      catch {
        stopPolling()
        searching.value = false
        return
      }
      pollTimer = setTimeout(poll, polls <= 5 ? 1000 : 2000)
    }
    pollTimer = setTimeout(poll, 1000)
  }
  catch (e: any) {
    downloadError.value = e.data?.message || e.message || 'Search failed'
    searching.value = false
  }
}

const startDownload = (result: DownloadSearchResult) => {
  stopPolling()
  emit('update:modelValue', false)
  terminal.runDownload('slskd', searchQuery.value, props.releaseTitle, props.artistName, props.releaseYear ?? null)
}

const formatBadgeClass = (format: string) => {
  if (format === 'FLAC') {
    return 'bg-emerald-500/20 text-emerald-400'
  }

  if (format.includes('MP3') || format === 'MP3 320') {
    return 'bg-blue-500/20 text-blue-400'
  }

  return 'bg-ink-2/20 text-ink-2'
}

const folderName = (path: string) => path.split('/').pop() || path
</script>

<template>
  <Dialog :model-value="modelValue" :title="dialogTitle" :subtitle="dialogSubtitle" max-width="2xl" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="downloadStarted" class="flex flex-col items-center gap-3 py-8">
      <CheckCircle :size="32" class="text-emerald-500" />
      <p class="text-sm text-ink-2">Download started</p>
    </div>

    <template v-else>
      <SearchInput
        v-model="searchQuery"
        placeholder="Search Soulseek..."
        show-submit
        :disabled="searching"
        :debounce="0"
        size="md"
        class="mb-4"
        @submit="doSearch"
      />

      <div v-if="downloadError" class="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
        <AlertCircle :size="14" class="shrink-0 text-red-400" />
        <p class="text-sm text-red-400">{{ downloadError }}</p>
      </div>

      <div v-if="searching && results.length === 0" class="flex flex-col gap-1">
        <div v-for="i in 5" :key="i" class="flex items-center gap-3 px-3 py-2.5">
          <Skeleton class="h-5 w-12" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <Skeleton class="h-4 w-3/4" />
            <Skeleton class="h-3 w-1/2" />
          </div>
          <Skeleton class="h-4 w-6" />
          <Skeleton class="h-7 w-20 rounded-lg" />
        </div>
      </div>

      <div v-else-if="results.length > 0">
        <p v-if="searching" class="mb-2 text-sm text-ink-2">
          <Loader2 :size="12" class="mr-1 inline animate-spin" />
          Searching Soulseek... {{ results.length }} results so far
        </p>

        <div class="overflow-y-auto rounded-lg border border-rule">
          <table class="w-full">
            <thead>
              <tr class="border-b border-rule bg-bg-1">
                <th
                  v-for="col in columns"
                  :key="col.key"
                  class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-2"
                  :class="[
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.sortable ? 'cursor-pointer select-none hover:text-ink transition-colors' : '',
                  ]"
                  @click="toggleSort(col)"
                >
                  <span class="inline-flex items-center gap-1">
                    {{ col.label }}
                    <template v-if="col.sortable">
                      <ArrowUp v-if="sortKey === col.key && sortDir === 'asc'" :size="12" />
                      <ArrowDown v-else-if="sortKey === col.key && sortDir === 'desc'" :size="12" />
                      <ArrowUpDown v-else :size="12" class="opacity-30" />
                    </template>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="result in sortedResults"
                :key="result.id"
                class="cursor-pointer border-b border-rule last:border-0 transition-colors hover:bg-accent/5 hover:border-accent/20"
                @click="startDownload(result)"
                :title="`Download ${folderName(result.folderPath)}`"
              >
                <td class="px-3 py-2">
                  <div
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="formatBadgeClass(result.format)"
                  >
                    {{ result.format }}
                    <span v-if="result.avgBitrate" class="ml-1">
                      {{ result.avgBitrate }}k
                    </span>
                  </div>
                </td>

                <td class="px-3 py-2">
                  <div class="truncate text-sm text-ink">{{ folderName(result.folderPath) }}</div>
                  <div class="flex items-center gap-2 text-sm text-ink-2">
                    <span>{{ result.username }}</span>
                    <span>{{ result.fileCount }} files</span>
                    <span v-if="result.queueLength" class="text-ink-4">{{ result.queueLength }} in queue</span>
                  </div>
                </td>

                <td class="px-3 py-2 text-right text-sm text-ink-2">
                  {{ result.totalSize ? formatFileSize(result.totalSize) : '-' }}
                </td>

                <td class="pl-3 pr-4 py-2 text-right text-sm text-ink-2">
                  {{ result.uploadSpeed ? formatSpeed(result.uploadSpeed) : '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="!searching" class="py-8 text-center text-sm text-ink-2">
        No results found. Try adjusting your search query.
      </div>
    </template>
  </Dialog>
</template>
