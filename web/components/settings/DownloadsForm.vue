<script setup lang="ts">
import { grid } from '~/helpers/ui'

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

// Empty string = "use env default" (sent as null). Numbers kept as strings in the inputs.
const num = (v: any) => (v ?? '') === '' ? '' : String(v)
const monitoring = reactive({
  maxConcurrentDownloads: num(settings.value?.maxConcurrentDownloads),
  searchPicksPerInterval: num(settings.value?.searchPicksPerInterval),
  searchIntervalSec: num(settings.value?.searchIntervalSec),
  gapsPicksPerRun: num(settings.value?.gapsPicksPerRun),
  gapsIntervalMin: num(settings.value?.gapsIntervalMin),
  retryCooldownDays: num(settings.value?.retryCooldownDays),
  noProgressSec: num(settings.value?.noProgressSec),
  maxDownloadAttempts: num(settings.value?.maxDownloadAttempts),
})

const triState = (v: boolean | null | undefined): 'default' | 'on' | 'off' =>
  v === null || v === undefined ? 'default' : v ? 'on' : 'off'

// Tri-state: default (env) / on / off
const enabledChoice = ref(triState(settings.value?.monitorEnabled))
const songkongChoice = ref(triState(settings.value?.songkongEnabled))
const autoMergeChoice = ref(triState(settings.value?.autoMergeDownloads))

const toNull = (v: string) => v === '' ? null : Number(v)
const fromChoice = (c: 'default' | 'on' | 'off') => c === 'default' ? null : c === 'on'

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
      monitorEnabled: fromChoice(enabledChoice.value),
      songkongEnabled: fromChoice(songkongChoice.value),
      autoMergeDownloads: fromChoice(autoMergeChoice.value),
      maxConcurrentDownloads: toNull(monitoring.maxConcurrentDownloads),
      searchPicksPerInterval: toNull(monitoring.searchPicksPerInterval),
      searchIntervalSec: toNull(monitoring.searchIntervalSec),
      gapsPicksPerRun: toNull(monitoring.gapsPicksPerRun),
      gapsIntervalMin: toNull(monitoring.gapsIntervalMin),
      retryCooldownDays: toNull(monitoring.retryCooldownDays),
      noProgressSec: toNull(monitoring.noProgressSec),
      maxDownloadAttempts: toNull(monitoring.maxDownloadAttempts),
    },
  })
  await refresh()
})
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <DownloadsAcquisitionIdleBanner />

    <UiCard title="Download Settings">
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

      <p class="text-sm text-stone-100/55">
        Leave a field blank to use the environment default. Changes apply live (no restart),
        except the base reconcile tick (RECONCILE_SEC, env only).
      </p>

      <UiSelect
        v-model="enabledChoice"
        label="Monitoring"
        description="Master switch for the download + catalogue loops."
      >
        <option value="default">- use env default (MONITOR_ENABLED) -</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </UiSelect>

      <div :class="grid.halfRow">
        <SettingsField
          v-model="monitoring.maxConcurrentDownloads"
          label="Max concurrent downloads"
          description="Cap on simultaneous active Soulseek transfers. The worker tops up to this. Default 5. (MAX_CONCURRENT_DOWNLOADS)" type="number"
          placeholder="5"
        />
        <SettingsField
          v-model="monitoring.searchPicksPerInterval"
          label="Search picks per interval"
          description="How many new missing releases the worker searches each top-up. Default 3. (SEARCH_PICKS_PER_INTERVAL)" type="number"
          placeholder="3"
        />
        <SettingsField
          v-model="monitoring.searchIntervalSec"
          label="Search interval (seconds)"
          description="Minimum seconds between download top-up runs (throttle). Default 60. (SEARCH_INTERVAL_SEC)" type="number"
          placeholder="60"
        />
        <SettingsField
          v-model="monitoring.gapsPicksPerRun"
          label="Catalogue-gap picks per run"
          description="Monitored artists whose MusicBrainz catalogue is refreshed each gap run (round-robin). Default 20. (GAPS_PICKS_PER_RUN)" type="number"
          placeholder="20"
        />
        <SettingsField
          v-model="monitoring.gapsIntervalMin"
          label="Catalogue-gap interval (minutes)"
          description="Minutes between catalogue-gap runs. Default 5. (GAPS_INTERVAL_MIN)" type="number"
          placeholder="5"
        />
        <SettingsField
          v-model="monitoring.retryCooldownDays"
          label="Retry cooldown (days)"
          description="Wait this many days before retrying a FAILED/UNAVAILABLE/INVALID release. Default 7. (RETRY_COOLDOWN_DAYS)" type="number"
          placeholder="7"
        />
        <SettingsField
          v-model="monitoring.noProgressSec"
          label="No-progress timeout (seconds)"
          description="Kill a download making no byte progress for this long. Default 60. (NO_PROGRESS_SEC)" type="number"
          placeholder="60"
        />
        <SettingsField
          v-model="monitoring.maxDownloadAttempts"
          label="Max attempts before giving up"
          description="After this many failed attempts a release is abandoned (never auto-retried). Default 3. (MAX_DOWNLOAD_ATTEMPTS)" type="number"
          placeholder="3"
        />
      </div>

      <UiSelect
        v-model="songkongChoice"
        label="SongKong enrichment"
        description="Enrich finished downloads (AcoustID, MusicBrainz IDs, genres, cover art) before the library folder layout is applied. Requires the host SongKong drainer cron. (SONGKONG_ENABLED)"
      >
        <option value="default">- use env default (SONGKONG_ENABLED) -</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </UiSelect>

      <UiSelect
        v-model="autoMergeChoice"
        label="Auto-merge into library"
        description="When on, ready downloads are merged into the music library automatically (no manual “Merge”). Off by default — merging stays a manual gate. (AUTO_MERGE)"
      >
        <option value="default">- use env default (AUTO_MERGE) -</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </UiSelect>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
    </UiCard>
  </div>
</template>
