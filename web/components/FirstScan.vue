<script setup lang="ts">
import { Disc3, RefreshCw, HardDriveDownload, Loader2, Square, LockOpen } from 'lucide-vue-next'
import type { ScanStatus } from '~/types/scan'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()

const status = ref<ScanStatus | null>(null)
const unlocking = ref(false)

const staleLock = computed(() =>
  !terminal.isRunning && status.value?.isRunning ? status.value : null,
)

const fetchStatus = async () => {
  try {
    status.value = await $fetch<ScanStatus>('/api/scan/status')
  }
  catch { /* ignore */ }
}

const forceUnlock = async () => {
  unlocking.value = true
  try {
    await $fetch('/api/scan/unlock', { method: 'POST' })
    await fetchStatus()
  }
  catch { /* ignore */ }
  finally {
    unlocking.value = false
  }
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
      <div class="flex size-16 items-center justify-center rounded-full bg-bg-2">
        <Disc3 :size="32" class="text-ink-4" />
      </div>

      <div>
        <h2 class="text-lg font-semibold text-ink">Your catalogue is empty</h2>
        <p class="mt-2 text-sm text-ink-2">
          Scan your music library to get started. This will read metadata from your audio files and build your catalogue.
        </p>
      </div>

      <div class="flex w-full flex-col gap-3">
        <button
          :disabled="terminal.isRunning"
          class="flex w-full items-center gap-4 rounded-xl border border-accent/30 bg-accent/10 px-6 py-5 text-left transition-colors hover:border-accent/50 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
          @click="fullScan"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/20">
            <Loader2 v-if="terminal.isRunning" :size="20" class="animate-spin text-accent" />
            <RefreshCw v-else :size="20" class="text-accent" />
          </div>
          <div>
            <p class="text-sm font-semibold text-ink">Full scan</p>
            <p class="text-xs text-ink-2">Index local files and sync against MusicBrainz</p>
          </div>
        </button>

        <button
          :disabled="terminal.isRunning"
          class="flex w-full items-center gap-3 rounded-lg border border-rule bg-bg-1 px-4 py-3 text-left transition-colors hover:border-rule hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-40"
          @click="indexOnly"
        >
          <Loader2 v-if="terminal.isRunning" :size="16" class="shrink-0 animate-spin text-ink-2" />
          <HardDriveDownload v-else :size="16" class="shrink-0 text-ink-2" />
          <div>
            <p class="text-xs font-medium text-ink-2">Index only</p>
            <p class="text-xs text-ink0">Scan local audio files without MusicBrainz sync</p>
          </div>
        </button>

        <button
          v-if="terminal.isRunning"
          class="flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
          @click="terminal.stop()"
        >
          <Square :size="12" />
          Stop
        </button>

        <div
          v-if="staleLock"
          class="flex w-full flex-col items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3"
        >
          <p class="text-xs text-ink-2">
            Lock held by <span class="text-ink-2">{{ staleLock.lockedBy }}</span> (pid {{ staleLock.pid }})
          </p>
          <button
            :disabled="unlocking"
            class="flex items-center gap-1.5 rounded-md border border-rule px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-bg-2 disabled:opacity-50"
            @click="forceUnlock"
          >
            <Loader2 v-if="unlocking" :size="12" class="animate-spin" />
            <LockOpen v-else :size="12" />
            Force Unlock
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
