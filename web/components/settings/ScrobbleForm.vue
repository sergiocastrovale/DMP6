<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle, ExternalLink, Unlink } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db-scrobble', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const apiKey = ref(settings.value?.lastfmApiKey ?? '')
const secret = ref(settings.value?.lastfmSecret ?? '')
const connectedUsername = computed(() => settings.value?.lastfmUsername ?? '')
// lastfmSessionKey is masked to '' by the API — check the isSet flag instead of the (always blank) value.
const isConnected = computed(() => !!settings.value?.lastfmSessionKeySet)

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      lastfmApiKey: apiKey.value || null,
      lastfmSecret: secret.value || undefined,
    },
  })
  await refresh()
})

const connecting = ref(false)

const connect = async () => {
  connecting.value = true
  try {
    const { url } = await $fetch<{ url: string }>('/api/scrobble/connect')
    window.location.href = url
  } catch (e: any) {
    error.value = e.data?.message || 'Failed to start Last.fm auth'
    connecting.value = false
  }
}

const disconnecting = ref(false)

const disconnect = async () => {
  disconnecting.value = true
  try {
    await $fetch('/api/settings', {
      method: 'PUT',
      body: {
        lastfmSessionKey: null,
        lastfmUsername: null,
      },
    })
    await refresh()
  } catch (e: any) {
    error.value = e.data?.message || 'Failed to disconnect'
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Last.fm Scrobbling</h2>

      <div v-if="isConnected" class="flex items-center gap-3 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-4 py-3">
        <CheckCircle2 :size="18" class="text-emerald-400 shrink-0" />
        <div class="flex-1">
          <p class="text-sm text-emerald-300">
            Connected as <span class="font-semibold">{{ connectedUsername }}</span>
          </p>
          <p class="text-xs text-ink0">Tracks are being scrobbled to Last.fm</p>
        </div>
        <button
          :disabled="disconnecting || !canEdit"
          class="flex items-center gap-1.5 rounded bg-bg-2 px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-bg-3 disabled:opacity-50"
          @click="disconnect"
        >
          <Unlink :size="12" />
          {{ disconnecting ? 'Disconnecting…' : 'Disconnect' }}
        </button>
      </div>

      <div v-else class="flex items-center gap-3 rounded-lg border border-rule/50 bg-bg-2/50 px-4 py-3">
        <AlertCircle :size="18" class="text-ink0 shrink-0" />
        <p class="flex-1 text-sm text-ink-2">Not connected to Last.fm</p>
      </div>

      <SettingsField
        v-model="apiKey"
        label="API Key"
        description="From your Last.fm API application"
        placeholder="Your Last.fm API key"
      />

      <SettingsField
        v-model="secret"
        label="Shared Secret"
        description="From your Last.fm API application"
        type="password"
        :placeholder="settings?.lastfmSecretSet ? 'Set — leave blank to keep' : 'Your Last.fm shared secret'"
      />

      <div class="flex items-center gap-3 pt-2">
        <button
          :disabled="saving || !canEdit"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          @click="save"
        >
          <Save :size="15" />
          {{ saving ? 'Saving…' : 'Save' }}
        </button>

        <button
          v-if="!isConnected && apiKey && (secret || settings?.lastfmSecretSet)"
          :disabled="connecting || !canEdit"
          class="flex items-center gap-2 rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          @click="connect"
        >
          <ExternalLink :size="15" />
          {{ connecting ? 'Redirecting…' : 'Connect Last.fm' }}
        </button>

        <span v-if="saved" class="flex items-center gap-1.5 text-sm text-emerald-400">
          <CheckCircle2 :size="15" /> Saved
        </span>
        <span v-if="error" class="flex items-center gap-1.5 text-sm text-red-400">
          <AlertCircle :size="15" /> {{ error }}
        </span>
      </div>
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6">
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-2">How it works</h2>
      <ul class="space-y-1 text-sm text-ink-2">
        <li>Tracks are scrobbled after 50% played or 4 minutes (whichever first)</li>
        <li>Tracks under 30 seconds are not scrobbled</li>
        <li>"Now Playing" updates immediately when a track starts</li>
      </ul>
    </div>
  </div>
</template>
