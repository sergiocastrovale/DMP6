<script setup lang="ts">
import { Disc3, HardDriveDownload, Loader2, RefreshCw } from 'lucide-vue-next'
import type { ScanStatus } from '~/types/scan'
import { useTerminalStore } from '~/stores/terminal'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const terminal = useTerminalStore()

const status = ref<ScanStatus | null>(null)

const staleLock = computed(() =>
  !terminal.isRunning && status.value?.isRunning ? status.value : null,
)

const fetchStatus = async () => {
  try {
    status.value = await $fetch<ScanStatus>('/api/scan/status')
  }
  catch { /* ignore */ }
}

const fullScan = () => terminal.run('./refresh', [])
const indexOnly = () => terminal.run('./index', [])

watch(() => terminal.isRunning, (running, wasRunning) => {
  if (wasRunning && !running) {
    fetchStatus()
  }
})

onMounted(fetchStatus)
</script>

<template>
  <div class="flex items-center justify-center py-20">
    <div class="flex max-w-lg flex-col items-center gap-8 text-center">
      <div class="flex size-16 items-center justify-center rounded-full bg-stone-800">
        <Disc3 :size="32" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/50" />
      </div>

      <div>
        <h2 class="text-xl font-semibold text-stone-100">Your catalogue is empty</h2>
        <p class="mt-2 text-base text-stone-100/60">
          Scan your music library to get started. This will read metadata from your audio files and build your catalogue.
        </p>
      </div>

      <div class="flex w-full flex-col gap-3">
        <button
          type="button"
          :disabled="terminal.isRunning"
          class="flex w-full items-center gap-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-5 text-left transition-colors duration-150 hover:border-amber-400/50 hover:bg-amber-400/15 disabled:cursor-default disabled:opacity-40"
          @click="fullScan"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/20">
            <Loader2 v-if="terminal.isRunning" :size="20" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
            <RefreshCw v-else :size="20" :stroke-width="ICON_STROKE_WIDTH" class="text-amber-400" />
          </div>
          <div>
            <p class="text-base font-semibold text-stone-100">Full scan</p>
            <p class="text-sm text-stone-100/60">Index local files and sync against MusicBrainz</p>
          </div>
        </button>

        <button
          type="button"
          :disabled="terminal.isRunning"
          class="flex w-full items-center gap-3 rounded-lg border border-stone-100/10 bg-stone-900 px-4 py-3 text-left transition-colors duration-150 hover:bg-stone-800 disabled:cursor-default disabled:opacity-40"
          @click="indexOnly"
        >
          <Loader2 v-if="terminal.isRunning" :size="16" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 animate-spin text-stone-100/60" />
          <HardDriveDownload v-else :size="16" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 text-stone-100/60" />
          <div>
            <p class="text-sm font-medium text-stone-100/60">Index only</p>
            <p class="text-xs text-stone-100/55">Scan local audio files without MusicBrainz sync</p>
          </div>
        </button>

        <UiButtonStop v-if="terminal.isRunning" />

        <div
          v-if="staleLock"
          class="flex w-full flex-col items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3"
        >
          <p class="text-xs text-stone-100/60">
            Lock held by <span class="text-stone-100/60">{{ staleLock.lockedBy }}</span> (pid {{ staleLock.pid }})
          </p>
          <UiButtonForceUnlockScan @unlocked="fetchStatus" />
        </div>
      </div>
    </div>
  </div>
</template>
