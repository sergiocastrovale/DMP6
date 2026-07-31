<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const form = reactive({
  slskdUrl: settings.value?.slskdUrl ?? '',
  slskdApiKey: settings.value?.slskdApiKey ?? '',
  downloadsPath: settings.value?.downloadsPath ?? '',
  downloadDirTemplate: settings.value?.downloadDirTemplate ?? '',
  downloadFormats: settings.value?.downloadFormats ?? '',
  downloadMinBitrate: settings.value?.downloadMinBitrate ?? '',
  prowlarrUrl: settings.value?.prowlarrUrl ?? '',
  prowlarrApiKey: settings.value?.prowlarrApiKey ?? '',
  prowlarrIndexerId: settings.value?.prowlarrIndexerId ?? '',
  qbittorrentUrl: settings.value?.qbittorrentUrl ?? '',
  qbittorrentUser: settings.value?.qbittorrentUser ?? '',
  qbittorrentPass: settings.value?.qbittorrentPass ?? '',
  qbittorrentSavePath: settings.value?.qbittorrentSavePath ?? '',
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
      prowlarrUrl: form.prowlarrUrl || null,
      prowlarrApiKey: form.prowlarrApiKey || undefined,
      prowlarrIndexerId: form.prowlarrIndexerId || null,
      qbittorrentUrl: form.qbittorrentUrl || null,
      qbittorrentUser: form.qbittorrentUser || null,
      qbittorrentPass: form.qbittorrentPass || undefined,
      qbittorrentSavePath: form.qbittorrentSavePath || null,
    },
  })
  await refresh()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Soulseek (slskd)</h2>
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
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">RuTracker — Prowlarr (search)</h2>
      <p class="text-xs text-ink0">RuTracker is searched through Prowlarr (the RT login lives in Prowlarr, like Lidarr). When RuTracker is enabled it's tried first; Soulseek is the fallback.</p>
      <SettingsField
        v-model="form.prowlarrUrl"
        label="Prowlarr URL"
        description="Prowlarr base URL. Overrides PROWLARR_URL."
        placeholder="http://localhost:9696"
      />
      <SettingsField
        v-model="form.prowlarrApiKey"
        label="Prowlarr API Key"
        description="Settings → General → Security in Prowlarr. Overrides PROWLARR_API_KEY."
        type="password"
        :placeholder="settings?.prowlarrApiKeySet ? 'Set — leave blank to keep' : '••••••••'"
      />
      <SettingsField
        v-model="form.prowlarrIndexerId"
        label="Indexer ID (optional)"
        description="Restrict searches to a single Prowlarr indexer id (the RuTracker indexer). Blank = all. Overrides PROWLARR_INDEXER_ID."
        placeholder="e.g. 5"
      />
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">RuTracker — qBittorrent (download)</h2>
      <SettingsField
        v-model="form.qbittorrentUrl"
        label="qBittorrent URL"
        description="WebUI base URL. Overrides QBITTORRENT_URL."
        placeholder="http://localhost:8080"
      />
      <SettingsField
        v-model="form.qbittorrentUser"
        label="qBittorrent Username"
        description="WebUI username. Overrides QBITTORRENT_USER."
      />
      <SettingsField
        v-model="form.qbittorrentPass"
        label="qBittorrent Password"
        description="WebUI password. Overrides QBITTORRENT_PASS."
        type="password"
        :placeholder="settings?.qbittorrentPassSet ? 'Set — leave blank to keep' : '••••••••'"
      />
      <SettingsField
        v-model="form.qbittorrentSavePath"
        label="Save Path (optional)"
        description="qBittorrent-side path that maps to {Downloads Path}/_torrents on the shared volume. Only set this if qBittorrent mounts the volume at a different prefix. Overrides QBITTORRENT_SAVE_PATH."
        placeholder="/downloads/dmp/_torrents"
      />
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Download Settings</h2>
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
    </div>

    <div class="flex items-center gap-3">
      <button
        :disabled="saving || !canEdit"
        class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        @click="save"
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
