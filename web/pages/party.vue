<script setup lang="ts">
import { Radio, Copy, Check, Users, Loader2, AlertCircle, X } from 'lucide-vue-next'

const config = useRuntimeConfig()
const { isStreamMode } = useStreamMode()
const party = usePartyHost()
const copied = ref(false)

async function copyInviteUrl() {
  if (!party.inviteUrl.value) return
  try {
    await navigator.clipboard.writeText(party.inviteUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch { /* clipboard not available */ }
}

// Redirect to home if party is not enabled or if in listener mode
if (!config.public.partyEnabled || isStreamMode.value) {
  navigateTo('/')
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-12">
    <div class="mb-8 flex items-center gap-3">
      <Radio :size="28" class="text-amber-500" />
      <h1 class="text-2xl font-bold text-zinc-100">Music Party</h1>
    </div>

    <!-- Not Active -->
    <div v-if="!party.isActive.value && !party.isConnecting.value" class="space-y-6">
      <p class="text-zinc-400">
        Start a party session to stream your music to listeners in real time.
        Anyone with the link can tune in and hear what you're playing.
      </p>

      <div
        v-if="party.error.value"
        class="flex items-center gap-2 rounded-lg bg-red-500/10 p-4 text-red-400"
      >
        <AlertCircle :size="18" />
        <span>{{ party.error.value }}</span>
      </div>

      <button
        class="flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-medium text-zinc-950 transition-colors hover:bg-amber-400"
        @click="party.startSession()"
      >
        <Radio :size="18" />
        Start Session
      </button>
    </div>

    <!-- Connecting -->
    <div v-else-if="party.isConnecting.value" class="flex items-center gap-3 text-zinc-400">
      <Loader2 :size="20" class="animate-spin" />
      <span>Connecting to server...</span>
    </div>

    <!-- Active Session -->
    <div v-else class="space-y-6">
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="relative flex h-3 w-3">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span class="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
            <span class="text-sm font-medium text-green-400">Live</span>
          </div>
          <div class="flex items-center gap-2 text-sm text-zinc-400">
            <Users :size="16" />
            <span>{{ party.listenerCount.value }} {{ party.listenerCount.value === 1 ? 'listener' : 'listeners' }}</span>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Invite Link
          </label>
          <div class="flex items-center gap-2">
            <code class="flex-1 truncate rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
              {{ party.inviteUrl.value }}
            </code>
            <button
              class="rounded bg-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
              title="Copy invite URL"
              @click="copyInviteUrl"
            >
              <Check v-if="copied" :size="16" class="text-green-400" />
              <Copy v-else :size="16" />
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Session ID
          </label>
          <code class="rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-500">
            {{ party.sessionId.value }}
          </code>
        </div>
      </div>

      <button
        class="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
        @click="party.endSession()"
      >
        <X :size="16" />
        End Session
      </button>
    </div>
  </div>
</template>
