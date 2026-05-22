<script setup lang="ts">
import { ArrowDownToLine, X, Loader2, CheckCircle, AlertCircle } from 'lucide-vue-next'
import { useDownloadsStore } from '~/stores/downloads'

const downloads = useDownloadsStore()
const expanded = ref(false)

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return ''
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
}

function stateIcon(state: string) {
  if (state.includes('Completed') || state.includes('Succeeded')) return 'completed'
  if (state.includes('Error')) return 'errored'
  return 'active'
}

async function cancelDownload(dl: any) {
  try {
    await $fetch('/api/downloads/cancel', {
      method: 'POST',
      body: { source: dl.source, username: dl.username, id: dl.id },
    })
    downloads.fetchActive()
  }
  catch { /* ignore */ }
}
</script>

<template>
  <div v-if="downloads.activeCount > 0" class="fixed bottom-24 right-4 z-50">
    <!-- Expanded panel -->
    <div
      v-if="expanded"
      class="mb-2 w-80 rounded-lg border border-rule bg-bg-1 shadow-xl"
    >
      <div class="flex items-center justify-between border-b border-rule px-3 py-2">
        <span class="text-xs font-medium text-ink-2">Downloads</span>
        <button class="text-ink0 hover:text-ink-2 transition-colors" @click="expanded = false">
          <X :size="14" />
        </button>
      </div>
      <div class="max-h-64 overflow-y-auto p-2">
        <div
          v-for="dl in downloads.activeDownloads"
          :key="dl.id"
          class="flex items-center gap-2 rounded px-2 py-1.5"
        >
          <Loader2 v-if="stateIcon(dl.state) === 'active'" :size="12" class="shrink-0 animate-spin text-accent" />
          <CheckCircle v-else-if="stateIcon(dl.state) === 'completed'" :size="12" class="shrink-0 text-emerald-500" />
          <AlertCircle v-else :size="12" class="shrink-0 text-red-400" />

          <div class="min-w-0 flex-1">
            <div class="truncate text-xs text-ink-2">
              {{ dl.filename.split('/').pop() || dl.filename }}
            </div>
            <div class="flex items-center gap-2 text-[10px] text-ink0">
              <span v-if="dl.percentComplete > 0">{{ Math.round(dl.percentComplete) }}%</span>
              <span v-if="dl.averageSpeed">{{ formatSpeed(dl.averageSpeed) }}</span>
              <span v-if="dl.size">{{ formatSize(dl.bytesTransferred) }}/{{ formatSize(dl.size) }}</span>
            </div>
          </div>

          <button
            v-if="stateIcon(dl.state) === 'active'"
            class="shrink-0 text-ink-4 hover:text-red-400 transition-colors"
            title="Cancel"
            @click="cancelDownload(dl)"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Pill button -->
    <button
      class="flex items-center gap-2 rounded-lg border border-rule bg-bg-1 px-3 py-2 text-sm text-ink-2 shadow-lg transition-colors hover:border-ink-4 hover:bg-bg-2"
      @click="expanded = !expanded"
    >
      <ArrowDownToLine :size="14" class="text-accent" />
      <span>{{ downloads.activeCount }} downloading</span>
    </button>
  </div>
</template>
