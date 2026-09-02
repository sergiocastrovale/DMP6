<script setup lang="ts">
const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const downloadsEnabled = ref(settings.value?.downloadsEnabled ?? true)

const form = reactive({
  slskdUrl: settings.value?.slskdUrl ?? '',
  slskdApiKey: settings.value?.slskdApiKey ?? '',
  downloadsPath: settings.value?.downloadsPath ?? '',
  downloadDirTemplate: settings.value?.downloadDirTemplate ?? '',
  downloadFormats: settings.value?.downloadFormats ?? '',
  downloadMinBitrate: settings.value?.downloadMinBitrate ?? '',
})

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      slskdUrl: form.slskdUrl || null,
      slskdApiKey: form.slskdApiKey || undefined,
      downloadsPath: form.downloadsPath || null,
      downloadDirTemplate: form.downloadDirTemplate || null,
      downloadFormats: form.downloadFormats || null,
      downloadMinBitrate: form.downloadMinBitrate ? Number(form.downloadMinBitrate) : null,
      downloadsEnabled: downloadsEnabled.value,
    },
  })
  await refresh()
})
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Download Settings">
      <SettingsField
        v-model="form.downloadsPath"
        label="Downloads Path"
        description="Directory where downloaded files are saved. Overrides DOWNLOADS_PATH."
        placeholder="/path/to/downloads"
      />
      <SettingsField
        v-model="form.downloadDirTemplate"
        label="Directory Template"
        description="Folder template. Placeholders: {artist}, {album}, {year}. Overrides DOWNLOAD_DIR_TEMPLATE."
        placeholder="{artist}/{year} - {album}"
      />
      <SettingsField
        v-model="form.downloadFormats"
        label="Allowed Formats"
        description="Comma-separated list (e.g. flac,mp3). Overrides DOWNLOAD_FORMATS."
        placeholder="flac,mp3"
      />
      <SettingsField
        v-model="form.downloadMinBitrate"
        label="Minimum Bitrate (kbps)"
        description="Minimum bitrate filter. Overrides DOWNLOAD_MIN_BITRATE."
        type="number"
        placeholder="320"
      />

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
    </UiCard>

    <UiCard title="Soulseek (slskd)">
      <Switch v-model="downloadsEnabled" label="Downloads enabled" />
      <SettingsField
        v-model="form.slskdUrl"
        label="slskd URL"
        description="REST API base URL. Overrides SLSKD_URL."
        placeholder="http://localhost:5030"
      />
      <SettingsField
        v-model="form.slskdApiKey"
        label="slskd API Key"
        description="X-API-Key header value. Overrides SLSKD_API_KEY."
        type="password"
        :placeholder="settings?.slskdApiKeySet ? 'Set — leave blank to keep' : '••••••••'"
      />

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
    </UiCard>
  </div>
</template>
