<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const form = reactive({
  slskdUrl: settings.value?.slskdUrl ?? '',
  slskdApiKey: settings.value?.slskdApiKey ?? '',
  deezerArl: settings.value?.deezerArl ?? '',
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
      slskdApiKey: form.slskdApiKey || null,
      deezerArl: form.deezerArl || null,
      downloadsPath: form.downloadsPath || null,
      downloadDirTemplate: form.downloadDirTemplate || null,
      downloadFormats: form.downloadFormats || null,
      downloadMinBitrate: form.downloadMinBitrate ? Number(form.downloadMinBitrate) : null,
    },
  })
  await refresh()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <!-- slskd -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Soulseek (slskd)</h2>
      <SettingsField
        label="slskd URL"
        description="REST API base URL. Overrides SLSKD_URL."
        placeholder="http://localhost:5030"
        v-model="form.slskdUrl"
      />
      <SettingsField
        label="slskd API Key"
        description="X-API-Key header value. Overrides SLSKD_API_KEY."
        type="password"
        placeholder="••••••••"
        v-model="form.slskdApiKey"
      />
    </div>

    <!-- Deezer -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Deezer</h2>
      <SettingsField
        label="ARL Cookie"
        description="Deezer ARL cookie from a logged-in session. Overrides DEEZER_ARL."
        type="password"
        placeholder="••••••••"
        v-model="form.deezerArl"
      />
    </div>

    <!-- Download settings -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Download Settings</h2>
      <SettingsField
        label="Downloads Path"
        description="Directory where downloaded files are saved. Overrides DOWNLOADS_PATH."
        placeholder="/path/to/downloads"
        v-model="form.downloadsPath"
      />
      <SettingsField
        label="Directory Template"
        description="Folder template. Placeholders: {artist}, {album}, {year}. Overrides DOWNLOAD_DIR_TEMPLATE."
        placeholder="{artist}/{year} - {album}"
        v-model="form.downloadDirTemplate"
      />
      <SettingsField
        label="Allowed Formats"
        description="Comma-separated list (e.g. flac,mp3). Overrides DOWNLOAD_FORMATS."
        placeholder="flac,mp3"
        v-model="form.downloadFormats"
      />
      <SettingsField
        label="Minimum Bitrate (kbps)"
        description="Minimum bitrate filter. Overrides DOWNLOAD_MIN_BITRATE."
        type="number"
        placeholder="320"
        v-model="form.downloadMinBitrate"
      />
    </div>

    <div class="flex items-center gap-3">
      <button
        :disabled="saving"
        @click="save"
        class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        <Save :size="15" />
        {{ saving ? 'Saving…' : 'Save Changes' }}
      </button>
      <span v-if="saved" class="flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 :size="15" /> Saved
      </span>
      <span v-if="error" class="flex items-center gap-1.5 text-sm text-red-400">
        <AlertCircle :size="15" /> {{ error }}
      </span>
    </div>
  </div>
</template>
