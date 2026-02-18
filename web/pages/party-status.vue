<script setup lang="ts">
import { Radio } from 'lucide-vue-next'

const config = useRuntimeConfig()
const { isStreamMode } = useStreamMode()

const status = ref<any>(null)
const error = ref<string | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    status.value = await $fetch('/api/party/status')
  }
  catch (err) {
    error.value = (err as Error).message
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-12">
    <div class="mb-8 flex items-center gap-3">
      <Radio :size="28" class="text-amber-500" />
      <h1 class="text-2xl font-bold text-zinc-100">Party Mode Status</h1>
    </div>

    <div v-if="loading" class="text-zinc-400">Loading...</div>

    <div v-else class="space-y-4">
      <!-- Server Configuration -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-3 text-sm font-medium text-zinc-400">Server Configuration</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-zinc-500">Party Enabled:</span>
            <span :class="config.public.partyEnabled ? 'text-green-400' : 'text-red-400'">
              {{ config.public.partyEnabled ? 'Yes' : 'No' }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-500">Party Role:</span>
            <span :class="config.public.partyRole === 'host' ? 'text-blue-400' : 'text-amber-400'">
              {{ config.public.partyRole }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-500">Stream Mode:</span>
            <span :class="isStreamMode ? 'text-amber-400' : 'text-blue-400'">
              {{ isStreamMode ? 'Yes (Listener)' : 'No (Host)' }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-500">Party URL:</span>
            <span class="text-zinc-300">{{ config.public.partyUrl || 'Not set' }}</span>
          </div>
        </div>
      </div>

      <!-- Session Status -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 class="mb-3 text-sm font-medium text-zinc-400">Session Status</h2>
        <div v-if="error" class="text-sm text-red-400">
          Error: {{ error }}
        </div>
        <div v-else-if="status" class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-zinc-500">Active Session:</span>
            <span :class="status.active ? 'text-green-400' : 'text-zinc-400'">
              {{ status.active ? 'Yes' : 'No' }}
            </span>
          </div>
          <div v-if="status.active" class="flex justify-between">
            <span class="text-zinc-500">Listener Count:</span>
            <span class="text-zinc-300">{{ status.listenerCount || 0 }}</span>
          </div>
          <div v-if="status.currentTrack" class="mt-3 border-t border-zinc-800 pt-3">
            <div class="text-zinc-500 mb-1">Now Playing:</div>
            <div class="text-zinc-100">{{ status.currentTrack.title }}</div>
            <div class="text-sm text-zinc-400">{{ status.currentTrack.artist }}</div>
          </div>
        </div>
      </div>

      <!-- Usage Guide -->
      <div class="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <h2 class="mb-2 text-sm font-medium text-blue-400">How Party Mode Works</h2>
        <div class="space-y-2 text-sm text-zinc-300">
          <div v-if="config.public.partyRole === 'host'">
            <p class="font-medium text-blue-300">🎵 This is the HOST server</p>
            <ul class="mt-2 space-y-1 list-disc list-inside">
              <li>Go to <code class="text-blue-400">/party</code> to start a session</li>
              <li>Play music - it will stream to the listener server</li>
              <li>Share the invite URL with others</li>
            </ul>
          </div>
          <div v-else>
            <p class="font-medium text-amber-300">📻 This is the LISTENER server</p>
            <ul class="mt-2 space-y-1 list-disc list-inside">
              <li>This server receives audio from the host</li>
              <li>Anyone visiting this URL can listen to the stream</li>
              <li>The host must start a session first</li>
              <li>Use <code class="text-amber-400">/party-debug</code> for detailed diagnostics</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
