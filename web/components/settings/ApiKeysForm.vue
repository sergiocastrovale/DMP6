<script setup lang="ts">
import { CheckCircle2, AlertCircle, ExternalLink, Unlink, CircleHelp } from 'lucide-vue-next'
import { cx, surface } from '~/helpers/ui'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
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
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Fanart.tv">
      <SettingsField
        v-model="fanartApiKey"
        label="API Key"
        description="Used by the sync script to fetch artist images. Overrides FANART_API_KEY."
        type="password"
        placeholder="••••••••"
      />
      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
    </UiCard>

    <UiCard>
      <template #header>
        <h2 class="text-lg font-semibold text-stone-100">Last.fm Scrobbling</h2>
        <Popover trigger="hover" placement="bottom-start">
          <template #trigger>
            <button type="button" aria-label="How scrobbling works" class="cursor-help text-stone-100/25 hover:text-stone-100/55">
              <CircleHelp :size="15" />
            </button>
          </template>
          <template #content>
            <div :class="cx(surface.popover, 'w-72 p-3 text-left')">
              <ul class="flex flex-col gap-1 text-sm font-normal normal-case tracking-normal text-stone-100/60">
                <li>Tracks are scrobbled after 50% played or 4 minutes (whichever first)</li>
                <li>Tracks under 30 seconds are not scrobbled</li>
                <li>"Now Playing" updates immediately when a track starts</li>
              </ul>
            </div>
          </template>
        </Popover>
      </template>

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

      <SettingsField
        v-model="lastfmApiKey"
        label="API Key"
        description="From your Last.fm API application"
        placeholder="Your Last.fm API key"
      />

      <SettingsField
        v-model="lastfmSecret"
        label="Shared Secret"
        description="From your Last.fm API application"
        type="password"
        :placeholder="settings?.lastfmSecretSet ? 'Set — leave blank to keep' : 'Your Last.fm shared secret'"
      />

      <SettingsSaveBar :saving="lastfmSaving" :saved="lastfmSaved" :error="lastfmError" :disabled="!canEdit" label="Save" class="pt-2" @save="lastfmSave">
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
  </div>
</template>
