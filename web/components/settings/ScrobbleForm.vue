<script setup lang="ts">
import { CheckCircle2, AlertCircle, ExternalLink, Unlink } from 'lucide-vue-next'

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
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Last.fm Scrobbling</h2>

      <div v-if="isConnected" class="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3">
        <CheckCircle2 :size="18" class="text-success shrink-0" />
        <div class="flex-1">
          <p class="text-base text-success">
            Connected as <span class="font-semibold">{{ connectedUsername }}</span>
          </p>
          <p class="text-sm text-stone-100/55">Tracks are being scrobbled to Last.fm</p>
        </div>
        <button
          :disabled="disconnecting || !canEdit"
          class="flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 disabled:opacity-50"
          @click="disconnect"
        >
          <Unlink :size="12" />
          {{ disconnecting ? 'Disconnecting…' : 'Disconnect' }}
        </button>
      </div>

      <div v-else class="flex items-center gap-3 rounded-lg border border-stone-100/6 bg-stone-800/50 px-4 py-3">
        <AlertCircle :size="18" class="text-stone-100/55 shrink-0" />
        <p class="flex-1 text-base text-stone-100/60">Not connected to Last.fm</p>
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

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" label="Save" class="pt-2" @save="save">
        <UiButton
          v-if="!isConnected && apiKey && (secret || settings?.lastfmSecretSet)"
          variant="danger"
          :icon="ExternalLink"
          :loading="connecting"
          :disabled="!canEdit"
          @click="connect"
        >
          {{ connecting ? 'Redirecting…' : 'Connect Last.fm' }}
        </UiButton>
      </SettingsSaveBar>
    </div>

    <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="mb-3 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">How it works</h2>
      <ul class="flex flex-col gap-1 text-base text-stone-100/60">
        <li>Tracks are scrobbled after 50% played or 4 minutes (whichever first)</li>
        <li>Tracks under 30 seconds are not scrobbled</li>
        <li>"Now Playing" updates immediately when a track starts</li>
      </ul>
    </div>
  </div>
</template>
