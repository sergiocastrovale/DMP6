<script setup lang="ts">
import { Radio, Volume2 } from 'lucide-vue-next'

const listener = usePartyListener()

onMounted(() => {
  console.log('[party-debug] Page mounted, connecting...')
  listener.connect()
})

function testPlay() {
  listener.togglePlay()
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-12">
    <div class="mb-8 flex items-center gap-3">
      <Radio :size="28" class="text-amber-500" />
      <h1 class="text-2xl font-bold text-zinc-100">Party Listener Debug</h1>
    </div>

    <div class="space-y-4">
      <!-- Connection Status -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-2 text-sm font-medium text-zinc-400">Connection</h2>
        <div class="flex items-center gap-2">
          <span
            :class="[
              'h-2 w-2 rounded-full',
              listener.isConnected.value ? 'bg-green-500' : 'bg-red-500'
            ]"
          />
          <span class="text-zinc-300">
            {{ listener.isConnected.value ? 'Connected' : 'Disconnected' }}
          </span>
        </div>
        <div v-if="listener.isReconnecting.value" class="mt-2 text-sm text-amber-500">
          Reconnecting...
        </div>
        <div v-if="listener.error.value" class="mt-2 text-sm text-red-400">
          Error: {{ listener.error.value }}
        </div>
      </div>

      <!-- Current Track -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-2 text-sm font-medium text-zinc-400">Current Track</h2>
        <div v-if="listener.currentTrack.value" class="space-y-1">
          <div class="text-zinc-100">{{ listener.currentTrack.value.title }}</div>
          <div class="text-sm text-zinc-400">{{ listener.currentTrack.value.artist }}</div>
        </div>
        <div v-else class="text-zinc-500">No track playing</div>
      </div>

      <!-- Playback State -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-2 text-sm font-medium text-zinc-400">Playback</h2>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-zinc-500">Status:</span>
            <span :class="listener.isPlaying.value ? 'text-green-400' : 'text-zinc-400'">
              {{ listener.isPlaying.value ? 'Playing' : 'Paused' }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-zinc-500">Position:</span>
            <span class="text-zinc-300">
              {{ Math.floor(listener.currentTime.value) }}s / {{ Math.floor(listener.duration.value) }}s
            </span>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-2 text-sm font-medium text-zinc-400">Controls</h2>
        <div class="flex gap-2">
          <button
            class="flex items-center gap-2 rounded bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
            @click="testPlay"
          >
            <Volume2 :size="16" />
            Toggle Play (Test Audio)
          </button>
          <button
            v-if="!listener.isConnected.value"
            class="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
            @click="listener.connect()"
          >
            Reconnect
          </button>
        </div>
      </div>

      <!-- Instructions -->
      <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <h2 class="mb-2 text-sm font-medium text-amber-400">Instructions</h2>
        <div class="space-y-3 text-sm text-zinc-300">
          <p class="font-medium text-amber-300">⚠️ This debug page only works on the LIVE SERVER (listener mode)</p>
          <ol class="space-y-1">
            <li>1. Make sure live server is deployed and running in listener mode</li>
            <li>2. Open this page on the live server: <code class="text-amber-400">https://your-domain.com/party-debug</code></li>
            <li>3. On your local dev server (host mode), go to <code class="text-amber-400">/party</code></li>
            <li>4. Click "Start Session" and play a track locally</li>
            <li>5. The live server debug page should connect and stream audio</li>
            <li>6. Check browser console on both sides for detailed logs</li>
          </ol>
          <p class="text-zinc-400 italic">
            Note: If you see "No active session" error, this page is running in host mode (local dev server).
            The listener functionality only works on the deployed server.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
