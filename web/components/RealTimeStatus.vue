<script setup lang="ts">
import {
  Loader2,
  CheckCircle2,
  Play,
  Square,
  LockOpen,
} from 'lucide-vue-next'
import type { ScanStatus } from '~/types/scan'
import { formatDate, parseProgress } from '~/helpers/functions'
import { ICON_STROKE_WIDTH, surface, typography } from '~/helpers/ui'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()
const settings = useSettingsStore()

const status = ref<ScanStatus | null>(null)
const loading = ref(true)
const polling = ref(false)
let pollInterval: ReturnType<typeof setInterval> | null = null

async function fetchStatus() {
  try {
    status.value = await $fetch<ScanStatus>('/api/scan/status')
  }
  catch (e) {
    console.error('Failed to fetch scan status:', e)
  }
  finally {
    loading.value = false
  }
}

function startPolling() {
  if (pollInterval) {return}
  polling.value = true
  pollInterval = setInterval(fetchStatus, 3000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  polling.value = false
}

watch(() => terminal.isRunning, (running) => {
  if (running) {
    startPolling()
  }
  else {
    stopPolling()
    fetchStatus()
  }
})

const progress = computed(() => parseProgress(terminal.lines))

const staleLock = computed(() =>
  !terminal.isRunning && status.value?.isRunning ? status.value : null,
)

const unlocking = ref(false)
const reconnecting = ref(false)

async function forceUnlock() {
  unlocking.value = true
  try {
    await $fetch('/api/scan/unlock', { method: 'POST' })
    await fetchStatus()
  }
  catch (e: any) {
    console.error('Force unlock failed:', e)
  }
  finally {
    unlocking.value = false
  }
}

async function reconnectSession() {
  const sessionName = staleLock.value?.sessionName
  if (!sessionName) { return }
  reconnecting.value = true
  try {
    await terminal.reconnect(sessionName)
  }
  catch {
    await fetchStatus()
  }
  finally {
    reconnecting.value = false
  }
}


function formatRelativeTime(iso: string | null): string {
  if (!iso) {return 'Never'}
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) {return 'Just now'}
  if (mins < 60) {return `${mins}m ago`}
  const hours = Math.floor(mins / 60)
  if (hours < 24) {return `${hours}h ago`}
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}


onMounted(() => {
  fetchStatus()
  if (terminal.isRunning) {startPolling()}
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiCard padding="sm" :gap="false">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 items-center justify-center rounded-full"
            :class="terminal.isRunning ? 'bg-amber-400/10' : 'bg-success/15'"
          >
            <Loader2 v-if="terminal.isRunning" :size="20" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
            <CheckCircle2 v-else :size="20" class="text-success" />
          </div>
          <div>
            <p class="text-base font-medium text-stone-100">
              {{ terminal.isRunning ? 'Scan in progress' : 'Idle' }}
            </p>
            <p v-if="terminal.isRunning && settings.showTerminal" class="text-sm text-stone-100/55">
              Check the terminal for live output
            </p>
            <p v-else-if="status" class="text-sm text-stone-100/55">
              Last scan: {{ formatRelativeTime(status.lastScanEndedAt) }}
            </p>
          </div>
        </div>
        <UiButton
          v-if="terminal.isRunning"
          variant="danger"
          size="sm"
          :icon="Square"
          @click="terminal.stop()"
        >
          Stop
        </UiButton>
      </div>

      <UiLoadingPanel
        v-if="terminal.isRunning && progress"
        class="mt-4"
        :label="`${progress.phase === 'index' ? 'Indexing' : 'Syncing'}: ${progress.folder || progress.artist} (${progress.current} / ${progress.total})`"
        :percent="Math.min(100, (progress.current / Math.max(1, progress.total)) * 100)"
      />

      <DroppedLinksNotice v-if="!terminal.isRunning" class="mt-4" />

      <div
        v-if="terminal.isRunning && terminal.lines.length > 0 && settings.showTerminal"
        class="mt-4 max-h-24 overflow-hidden rounded-md border border-stone-100/6 bg-stone-950 p-3 font-mono text-xs leading-5 text-stone-100/60 cursor-pointer"
        @click="terminal.open()"
      >
        <div v-for="(line, i) in terminal.lines.slice(-3)" :key="i" class="truncate">
          {{ line }}
        </div>
      </div>
    </UiCard>

    <div
      v-if="staleLock"
      class="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3"
    >
      <div>
        <p class="text-base font-medium text-amber-400">
          {{ staleLock.sessionName ? 'Session running in background' : 'Lock held externally' }}
        </p>
        <p class="text-sm text-stone-100/55">
          <span class="text-stone-100/60">{{ staleLock.lockedBy }}</span>
          (pid {{ staleLock.pid }})
          <template v-if="staleLock.sessionName"> - reconnect to view output</template>
          <template v-else> - process may have died without releasing the lock</template>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton
          v-if="staleLock.sessionName"
          variant="primary"
          size="sm"
          :icon="Play"
          :loading="reconnecting"
          :disabled="reconnecting"
          @click="reconnectSession"
        >
          Reconnect
        </UiButton>
        <UiButton
          variant="quiet"
          size="sm"
          :icon="LockOpen"
          :loading="unlocking"
          :disabled="unlocking"
          @click="forceUnlock"
        >
          Force Unlock
        </UiButton>
      </div>
    </div>

    <div>
      <h3 class="mb-3" :class="typography.sectionLabel">
        Scan Library
      </h3>
      <ScanActions :disabled="!!staleLock" />
    </div>

    <div v-if="status && !loading">
      <h3 class="mb-3" :class="typography.sectionLabel">
        History
      </h3>
      <div :class="[surface.card, 'divide-y divide-stone-100/6']">
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-base text-stone-100/60">Last scan started</span>
          <span class="text-base text-stone-100">{{ formatDate(status.lastScanStartedAt) }}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-base text-stone-100/60">Last scan completed</span>
          <span class="text-base text-stone-100">{{ formatDate(status.lastScanEndedAt) }}</span>
        </div>
        <div v-if="status.lastSyncedArtist" class="flex items-center justify-between px-4 py-3">
          <span class="text-base text-stone-100/60">Last synced artist</span>
          <span class="text-base text-stone-100">{{ status.lastSyncedArtist }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
