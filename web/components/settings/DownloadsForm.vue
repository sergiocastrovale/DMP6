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
    <!-- slskd -->
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Soulseek (slskd)</h2>
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
        :placeholder="settings?.slskdApiKeySet ? 'Set — leave blank to keep' : '••••••••'"
        v-model="form.slskdApiKey"
      />
    </div>

    <!-- RuTracker: Prowlarr (search) -->
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">RuTracker — Prowlarr (search)</h2>
      <p class="text-xs text-ink0">RuTracker is searched through Prowlarr (the RT login lives in Prowlarr, like Lidarr). When RuTracker is enabled it's tried first; Soulseek is the fallback.</p>
      <SettingsField
        label="Prowlarr URL"
        description="Prowlarr base URL. Overrides PROWLARR_URL."
        placeholder="http://localhost:9696"
        v-model="form.prowlarrUrl"
      />
      <SettingsField
        label="Prowlarr API Key"
        description="Settings → General → Security in Prowlarr. Overrides PROWLARR_API_KEY."
        type="password"
        :placeholder="settings?.prowlarrApiKeySet ? 'Set — leave blank to keep' : '••••••••'"
        v-model="form.prowlarrApiKey"
      />
      <SettingsField
        label="Indexer ID (optional)"
        description="Restrict searches to a single Prowlarr indexer id (the RuTracker indexer). Blank = all. Overrides PROWLARR_INDEXER_ID."
        placeholder="e.g. 5"
        v-model="form.prowlarrIndexerId"
      />
    </div>

    <!-- RuTracker: qBittorrent (download) -->
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">RuTracker — qBittorrent (download)</h2>
      <SettingsField
        label="qBittorrent URL"
        description="WebUI base URL. Overrides QBITTORRENT_URL."
        placeholder="http://localhost:8080"
        v-model="form.qbittorrentUrl"
      />
      <SettingsField
        label="qBittorrent Username"
        description="WebUI username. Overrides QBITTORRENT_USER."
        v-model="form.qbittorrentUser"
      />
      <SettingsField
        label="qBittorrent Password"
        description="WebUI password. Overrides QBITTORRENT_PASS."
        type="password"
        :placeholder="settings?.qbittorrentPassSet ? 'Set — leave blank to keep' : '••••••••'"
        v-model="form.qbittorrentPass"
      />
      <SettingsField
        label="Save Path (optional)"
        description="qBittorrent-side path that maps to {Downloads Path}/_torrents on the shared volume. Only set this if qBittorrent mounts the volume at a different prefix. Overrides QBITTORRENT_SAVE_PATH."
        placeholder="/downloads/dmp/_torrents"
        v-model="form.qbittorrentSavePath"
      />
    </div>

    <!-- Download settings -->
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Download Settings</h2>
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
        :disabled="saving || !canEdit"
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
