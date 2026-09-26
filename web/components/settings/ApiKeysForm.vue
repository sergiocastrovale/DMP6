<script setup lang="ts">
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

const geniusClientId = ref(settings.value?.geniusClientId ?? '')
const geniusSecret = ref(settings.value?.geniusSecret ?? '')
const geniusAccessToken = ref(settings.value?.geniusAccessToken ?? '')

const { saving: geniusSaving, saved: geniusSaved, error: geniusError, save: geniusSave } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      geniusClientId: geniusClientId.value || null,
      geniusSecret: geniusSecret.value || undefined,
      geniusAccessToken: geniusAccessToken.value || undefined,
    },
  })
  await refresh()
})

const lastfmApiKey = ref(settings.value?.lastfmApiKey ?? '')
const lastfmSecret = ref(settings.value?.lastfmSecret ?? '')
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

    <UiCard title="Genius" description="Used to fetch 'Did you know...' trivia facts for artists">
      <div class="text-sm text-stone-100/60">
        Create a client <a href="https://genius.com/api-clients" target="_blank" class="underline">here</a>.
        Only the access token is used to call the API; client ID/secret are stored for reference.
      </div>

      <div :class="grid.halfRow" class="mt-4">
        <SettingsField
          v-model="geniusClientId"
          label="Client ID"
          placeholder="Genius client ID"
          :disabled="!canEdit"
          @blur="geniusSave"
        />

        <SettingsField
          v-model="geniusSecret"
          label="Client Secret"
          type="password"
          :placeholder="settings?.geniusSecretSet ? 'Already set - leave blank to keep' : 'Genius client secret'"
          :disabled="!canEdit"
          @blur="geniusSave"
        />

        <SettingsField
          v-model="geniusAccessToken"
          label="Access Token"
          type="password"
          :placeholder="settings?.geniusAccessTokenSet ? 'Already set - leave blank to keep' : 'Genius access token'"
          description="Overrides GENIUS_CLIENT_ID/GENIUS_SECRET/GENIUS_ACCESS_TOKEN."
          :disabled="!canEdit"
          @blur="geniusSave"
        />
      </div>

      <SettingsSaveBar :saving="geniusSaving" :saved="geniusSaved" :error="geniusError" />
    </UiCard>

    <UiCard title="Last.fm" description="Application credentials shared by every listener">
      <div class="text-sm text-stone-100/60">
        Create your API key <a href="https://www.last.fm/api/authentication" target="_blank" class="underline">here</a>.
        Each user connects their own account, and scrobbles, under Settings → Last.fm.
      </div>

      <div :class="grid.halfRow" class="mt-4">
        <SettingsField
          v-model="lastfmApiKey"
          label="API Key"
          placeholder="Last.fm API key"
          :disabled="!canEdit"
          @blur="lastfmSave"
        />

        <SettingsField
          v-model="lastfmSecret"
          label="Shared Secret"
          type="password"
          :placeholder="settings?.lastfmSecretSet ? 'Already set - leave blank to keep' : 'Last.fm shared secret'"
          :disabled="!canEdit"
          @blur="lastfmSave"
        />
      </div>

      <SettingsSaveBar :saving="lastfmSaving" :saved="lastfmSaved" :error="lastfmError" class="pt-2" />
    </UiCard>
  </form>
</template>
