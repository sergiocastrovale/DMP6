<script setup lang="ts">
import { CheckCircle2, AlertCircle, ExternalLink, Unlink } from 'lucide-vue-next'
import { grid } from '~/helpers/ui'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  useCookieFetch<Record<string, any>>('/api/settings'),
)

const fanartApiKey = ref(settings.value?.fanartApiKey ?? '')

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: { fanartApiKey: fanartApiKey.value || null },
  })
  await refresh()
})

const lastfmApiKey = ref(settings.value?.lastfmApiKey ?? '')
const lastfmSecret = ref(settings.value?.lastfmSecret ?? '')
const connectedUsername = computed(() => settings.value?.lastfmUsername ?? '')
// lastfmSessionKey is masked to '' by the API — check the isSet flag instead of the (always blank) value.
const isConnected = computed(() => !!settings.value?.lastfmSessionKeySet)

const { saving: lastfmSaving, saved: lastfmSaved, error: lastfmError, save: lastfmSave } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      lastfmApiKey: lastfmApiKey.value || null,
      lastfmSecret: lastfmSecret.value || undefined,
    },
  })
  await refresh()
})

const connecting = ref(false)

const connect = async () => {
  connecting.value = true
  try {
    // The API key/secret fields save on blur, which may not have landed yet if the user tabbed
    // straight from the field to this button - persist explicitly first so connect always sees
    // the values currently on screen, not whatever was last saved.
    await lastfmSave()
    if (lastfmError.value) {
      connecting.value = false
      return
    }
    const { url } = await $fetch<{ url: string }>('/api/scrobble/connect')
    window.location.href = url
  } catch (e: any) {
    lastfmError.value = e.data?.message || 'Failed to start Last.fm auth'
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
    lastfmError.value = e.data?.message || 'Failed to disconnect'
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <form class="flex w-full max-w-7xl flex-col gap-6" @submit.prevent>
    <UiCard title="Fanart.tv">
      <div :class="grid.halfRow">
        <SettingsField
          v-model="fanartApiKey"
          label="API Key"
          description="Used by the sync script to fetch artist images. Overrides FANART_API_KEY."
          type="password"
          placeholder="••••••••"
          :disabled="!canEdit"
          @blur="save"
        />
      </div>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="Last.fm" description="Scrobble tracks to Last.fm">
      <div>
        <p class="text-sm text-stone-100/60">Scrobble tracks to last.fm.
          Create your API key <a href="https://www.last.fm/api/authentication" target="_blank" class="text-sm text-stone-100/60 underline">here</a>.
        </p>
      </div>

      <div v-if="isConnected" class="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3">
        <CheckCircle2 :size="18" class="text-success shrink-0" />
        <div class="flex-1">
          <p class="text-base text-success">
            Connected as <span class="font-semibold">{{ connectedUsername }}</span>
          </p>
          <p class="text-sm text-stone-100/55">Tracks are being scrobbled to Last.fm</p>
        </div>
        <UiButton
          variant="secondary"
          size="sm"
          :icon="Unlink"
          :loading="disconnecting"
          :disabled="disconnecting || !canEdit"
          @click="disconnect"
        >
          {{ disconnecting ? 'Disconnecting…' : 'Disconnect' }}
        </UiButton>
      </div>

      <div v-else class="flex items-center gap-3 rounded-lg border border-stone-100/6 bg-stone-800/50 px-4 py-3">
        <AlertCircle :size="18" class="text-stone-100/55 shrink-0" />
        <p class="flex-1 text-base text-stone-100/60">Not connected to Last.fm</p>
      </div>

      <div :class="grid.halfRow" class="mt-4">
        <SettingsField
          v-model="lastfmApiKey"
          label="API Key"
          placeholder="Last.fm API key"
          :disabled="!canEdit"
        />

        <SettingsField
          v-model="lastfmSecret"
          label="Shared Secret"
          type="password"
          :placeholder="settings?.lastfmSecretSet ? 'Already set - leave blank to keep' : 'Last.fm shared secret'"
          :disabled="!canEdit"
        />
      </div>

      <SettingsSaveBar :saving="lastfmSaving" :saved="lastfmSaved" :error="lastfmError" class="pt-2">
        <UiButton
          v-if="!isConnected && lastfmApiKey && (lastfmSecret || settings?.lastfmSecretSet)"
          variant="danger"
          :icon="ExternalLink"
          :loading="connecting"
          :disabled="!canEdit"
          @click="connect"
        >
          {{ connecting ? 'Redirecting…' : 'Connect Last.fm' }}
        </UiButton>
      </SettingsSaveBar>
    </UiCard>
  </form>
</template>
