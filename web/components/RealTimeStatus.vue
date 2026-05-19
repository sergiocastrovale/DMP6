<script setup lang="ts">
import {
  Loader2,
  CheckCircle2,
  Play,
  Square,
  LockOpen,
} from 'lucide-vue-next'
import type { ScanStatus } from '~/server/api/scan/status.get'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()

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
  if (pollInterval) return
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

interface ScanProgress {
  phase: 'index' | 'sync'
  folder?: string
  artist?: string
  current: number
  total: number
}

const progress = computed<ScanProgress | null>(() => {
  for (let i = terminal.lines.length - 1; i >= 0; i--) {
    const line = terminal.lines[i]
    if (typeof line === 'string' && line.startsWith('PROGRESS:')) {
      try {
        return JSON.parse(line.slice(9))
      }
      catch { /* ignore malformed */ }
    }
  }
  return null
})

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
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  fetchStatus()
  if (terminal.isRunning) startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Current Status -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 items-center justify-center rounded-full"
            :class="terminal.isRunning ? 'bg-amber-500/10' : 'bg-emerald-500/10'"
          >
            <Loader2 v-if="terminal.isRunning" :size="20" class="animate-spin text-amber-500" />
            <CheckCircle2 v-else :size="20" class="text-emerald-500" />
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-50">
              {{ terminal.isRunning ? 'Scan in progress' : 'Idle' }}
            </p>
            <p v-if="terminal.isRunning" class="text-xs text-zinc-500">
              Check the terminal for live output
            </p>
            <p v-else-if="status" class="text-xs text-zinc-500">
              Last scan: {{ formatRelativeTime(status.lastScanEndedAt) }}
            </p>
          </div>
        </div>
        <button
          v-if="terminal.isRunning"
          class="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
          @click="terminal.stop()"
        >
          <Square :size="12" />
          Stop
        </button>
      </div>

      <!-- Structured progress when available -->
      <div v-if="terminal.isRunning && progress" class="mt-4 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-zinc-400">
            {{ progress.phase === 'index' ? 'Indexing' : 'Syncing' }}:
            <span class="text-zinc-200">{{ progress.folder || progress.artist }}</span>
          </span>
          <span class="text-zinc-500">{{ progress.current }} / {{ progress.total }}</span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-zinc-800">
          <div
            class="h-1.5 rounded-full bg-amber-500 transition-all duration-300"
            :style="{ width: `${Math.min(100, (progress.current / Math.max(1, progress.total)) * 100)}%` }"
          />
        </div>
      </div>

      <!-- Terminal preview when running -->
      <div
        v-if="terminal.isRunning && terminal.lines.length > 0"
        class="mt-4 max-h-24 overflow-hidden rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-400 cursor-pointer"
        @click="terminal.open()"
      >
        <div v-for="(line, i) in terminal.lines.slice(-3)" :key="i" class="truncate">
          {{ line }}
        </div>
      </div>
    </div>

    <!-- Background / stale lock banner -->
    <div
      v-if="staleLock"
      class="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
    >
      <div>
        <p class="text-sm font-medium text-amber-400">
          {{ staleLock.sessionName ? 'Session running in background' : 'Lock held externally' }}
        </p>
        <p class="text-xs text-zinc-500">
          <span class="text-zinc-300">{{ staleLock.lockedBy }}</span>
          (pid {{ staleLock.pid }})
          <template v-if="staleLock.sessionName"> — reconnect to view output</template>
          <template v-else> — process may have died without releasing the lock</template>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="staleLock.sessionName"
          :disabled="reconnecting"
          class="flex items-center gap-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          @click="reconnectSession"
        >
          <Loader2 v-if="reconnecting" :size="12" class="animate-spin" />
          <Play v-else :size="12" />
          Reconnect
        </button>
        <button
          :disabled="unlocking"
          class="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          @click="forceUnlock"
        >
          <Loader2 v-if="unlocking" :size="12" class="animate-spin" />
          <LockOpen v-else :size="12" />
          Force Unlock
        </button>
      </div>
    </div>

    <!-- Scan Actions -->
    <div>
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Scan Library
      </h3>
      <ScanActions :disabled="!!staleLock" />
    </div>

    <!-- Last Scan Info -->
    <div v-if="status && !loading">
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        History
      </h3>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-zinc-400">Last scan started</span>
          <span class="text-sm text-zinc-200">{{ formatDate(status.lastScanStartedAt) }}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-zinc-400">Last scan completed</span>
          <span class="text-sm text-zinc-200">{{ formatDate(status.lastScanEndedAt) }}</span>
        </div>
        <div v-if="status.lastSyncedArtist" class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-zinc-400">Last synced artist</span>
          <span class="text-sm text-zinc-200">{{ status.lastSyncedArtist }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
