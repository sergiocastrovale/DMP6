<script setup lang="ts">
import { grid } from '~/helpers/ui'
import { urlField, positiveIntField, nonNegativeIntField, validateField } from '~/helpers/settingsValidation'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  useCookieFetch<Record<string, any>>('/api/settings'),
)

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

const fieldErrors = reactive({
  slskdUrl: '',
  downloadMinBitrate: '',
  maxConcurrentDownloads: '',
  searchPicksPerInterval: '',
  searchIntervalSec: '',
  gapsPicksPerRun: '',
  gapsIntervalMin: '',
  retryCooldownDays: '',
  noProgressSec: '',
  maxDownloadAttempts: '',
})

const triState = (v: boolean | null | undefined): 'default' | 'on' | 'off' =>
  v === null || v === undefined ? 'default' : v ? 'on' : 'off'

// Tri-state: default (env) / on / off
const downloadsEnabledChoice = ref(triState(settings.value?.downloadsEnabled))
const enabledChoice = ref(triState(settings.value?.monitorEnabled))
const songkongChoice = ref(triState(settings.value?.songkongEnabled))
const autoMergeChoice = ref(triState(settings.value?.autoMergeDownloads))

// Each master switch hides its own section's fields when explicitly turned off - "default"/"on"
// both leave them visible since the feature may still be running via the env default.
const downloadsFieldsVisible = computed(() => downloadsEnabledChoice.value !== 'off')
const monitoringFieldsVisible = computed(() => enabledChoice.value !== 'off')

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
      downloadsEnabled: fromChoice(downloadsEnabledChoice.value),
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

const onTextBlur = <K extends keyof typeof fieldErrors>(field: K, schema: Parameters<typeof validateField>[0], value: string) => {
  fieldErrors[field] = validateField(schema, value)
  if (!fieldErrors[field]) {save()}
}

const onChoiceChange = (setter: (v: string) => void, v: string) => {
  setter(v)
  save()
}
</script>

<template>
  <form class="flex w-full max-w-7xl flex-col gap-6" @submit.prevent>
    <DownloadsAcquisitionIdleBanner />

    <UiCard title="Download Settings">
      <UiSelect
        :model-value="downloadsEnabledChoice"
        label="Downloads enabled"
        description="Master switch for Soulseek acquisition."
        :disabled="!canEdit"
        @update:model-value="onChoiceChange(v => downloadsEnabledChoice = v as any, $event)"
      >
        <option value="default">- use env default (DOWNLOADS_ENABLED) -</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </UiSelect>

      <template v-if="downloadsFieldsVisible">
        <div :class="grid.halfRow">
          <SettingsField
            v-model="form.slskdUrl"
            label="slskd URL"
            description="REST API base URL. Overrides SLSKD_URL."
            placeholder="http://localhost:5030"
            :error="fieldErrors.slskdUrl"
            :disabled="!canEdit"
            @blur="onTextBlur('slskdUrl', urlField, form.slskdUrl)"
          />
          <SettingsField
            v-model="form.slskdApiKey"
            label="slskd API Key"
            description="X-API-Key header value. Overrides SLSKD_API_KEY."
            type="password"
            :placeholder="settings?.slskdApiKeySet ? 'Set — leave blank to keep' : '••••••••'"
            :disabled="!canEdit"
            @blur="save"
          />
          <SettingsField
            v-model="form.downloadsPath"
            label="Downloads Path"
            description="Directory where downloaded files are saved. Overrides DOWNLOADS_PATH."
            placeholder="/path/to/downloads"
            :disabled="!canEdit"
            @blur="save"
          />
          <SettingsField
            v-model="form.downloadDirTemplate"
            label="Directory Template"
            description="Folder template. Placeholders: {artist}, {album}, {year}. Overrides DOWNLOAD_DIR_TEMPLATE."
            placeholder="{artist}/{year} - {album}"
            :disabled="!canEdit"
            @blur="save"
          />
          <SettingsField
            v-model="form.downloadFormats"
            label="Allowed Formats"
            description="Comma-separated list (e.g. flac,mp3). Overrides DOWNLOAD_FORMATS."
            placeholder="flac,mp3"
            :disabled="!canEdit"
            @blur="save"
          />
          <SettingsField
            v-model="form.downloadMinBitrate"
            label="Minimum Bitrate (kbps)"
            description="Minimum bitrate filter. Overrides DOWNLOAD_MIN_BITRATE."
            type="number"
            placeholder="320"
            :error="fieldErrors.downloadMinBitrate"
            :disabled="!canEdit"
            @blur="onTextBlur('downloadMinBitrate', nonNegativeIntField, form.downloadMinBitrate)"
          />
        </div>

        <p class="text-sm text-stone-100/55">
          Leave a field blank to use the environment default. Changes apply live (no restart).
        </p>
      </template>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="Auto-monitoring">
      <UiSelect
        :model-value="enabledChoice"
        label="Monitoring"
        description="Master switch for the download + catalogue loops."
        :disabled="!canEdit"
        @update:model-value="onChoiceChange(v => enabledChoice = v as any, $event)"
      >
        <option value="default">- use env default (MONITOR_ENABLED) -</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </UiSelect>

      <template v-if="monitoringFieldsVisible">
        <div :class="grid.halfRow">
          <SettingsField
            v-model="monitoring.maxConcurrentDownloads"
            label="Max concurrent downloads"
            description="Cap on simultaneous active Soulseek transfers. The worker tops up to this. Default 5. (MAX_CONCURRENT_DOWNLOADS)" type="number"
            placeholder="5"
            :error="fieldErrors.maxConcurrentDownloads"
            :disabled="!canEdit"
            @blur="onTextBlur('maxConcurrentDownloads', positiveIntField, monitoring.maxConcurrentDownloads)"
          />
          <SettingsField
            v-model="monitoring.searchPicksPerInterval"
            label="Search picks per interval"
            description="How many new missing releases the worker searches each top-up. Default 3. (SEARCH_PICKS_PER_INTERVAL)" type="number"
            placeholder="3"
            :error="fieldErrors.searchPicksPerInterval"
            :disabled="!canEdit"
            @blur="onTextBlur('searchPicksPerInterval', positiveIntField, monitoring.searchPicksPerInterval)"
          />
          <SettingsField
            v-model="monitoring.searchIntervalSec"
            label="Search interval (seconds)"
            description="Minimum seconds between download top-up runs (throttle). Default 60. (SEARCH_INTERVAL_SEC)" type="number"
            placeholder="60"
            :error="fieldErrors.searchIntervalSec"
            :disabled="!canEdit"
            @blur="onTextBlur('searchIntervalSec', positiveIntField, monitoring.searchIntervalSec)"
          />
          <SettingsField
            v-model="monitoring.gapsPicksPerRun"
            label="Catalogue-gap picks per run"
            description="Monitored artists whose MusicBrainz catalogue is refreshed each gap run (round-robin). Default 20. (GAPS_PICKS_PER_RUN)" type="number"
            placeholder="20"
            :error="fieldErrors.gapsPicksPerRun"
            :disabled="!canEdit"
            @blur="onTextBlur('gapsPicksPerRun', positiveIntField, monitoring.gapsPicksPerRun)"
          />
          <SettingsField
            v-model="monitoring.gapsIntervalMin"
            label="Catalogue-gap interval (minutes)"
            description="Minutes between catalogue-gap runs. Default 5. (GAPS_INTERVAL_MIN)" type="number"
            placeholder="5"
            :error="fieldErrors.gapsIntervalMin"
            :disabled="!canEdit"
            @blur="onTextBlur('gapsIntervalMin', positiveIntField, monitoring.gapsIntervalMin)"
          />
          <SettingsField
            v-model="monitoring.retryCooldownDays"
            label="Retry cooldown (days)"
            description="Wait this many days before retrying a FAILED/UNAVAILABLE/INVALID release. Default 7. (RETRY_COOLDOWN_DAYS)" type="number"
            placeholder="7"
            :error="fieldErrors.retryCooldownDays"
            :disabled="!canEdit"
            @blur="onTextBlur('retryCooldownDays', positiveIntField, monitoring.retryCooldownDays)"
          />
          <SettingsField
            v-model="monitoring.noProgressSec"
            label="No-progress timeout (seconds)"
            description="Kill a download making no byte progress for this long. Default 60. (NO_PROGRESS_SEC)" type="number"
            placeholder="60"
            :error="fieldErrors.noProgressSec"
            :disabled="!canEdit"
            @blur="onTextBlur('noProgressSec', positiveIntField, monitoring.noProgressSec)"
          />
          <SettingsField
            v-model="monitoring.maxDownloadAttempts"
            label="Max attempts before giving up"
            description="After this many failed attempts a release is abandoned (never auto-retried). Default 3. (MAX_DOWNLOAD_ATTEMPTS)" type="number"
            placeholder="3"
            :error="fieldErrors.maxDownloadAttempts"
            :disabled="!canEdit"
            @blur="onTextBlur('maxDownloadAttempts', positiveIntField, monitoring.maxDownloadAttempts)"
          />
        </div>

        <div :class="grid.halfRow">
          <UiSelect
            :model-value="songkongChoice"
            label="SongKong enrichment"
            description="Enrich finished downloads (AcoustID, MusicBrainz IDs, genres, cover art) before the library folder layout is applied. Requires the host SongKong drainer cron. (SONGKONG_ENABLED)"
            :disabled="!canEdit"
            @update:model-value="onChoiceChange(v => songkongChoice = v as any, $event)"
          >
            <option value="default">- use env default (SONGKONG_ENABLED) -</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </UiSelect>

          <UiSelect
            :model-value="autoMergeChoice"
            label="Auto-merge into library"
            description="When on, ready downloads are merged into the music library automatically (no manual “Merge”). Off by default — merging stays a manual gate. (AUTO_MERGE)"
            :disabled="!canEdit"
            @update:model-value="onChoiceChange(v => autoMergeChoice = v as any, $event)"
          >
            <option value="default">- use env default (AUTO_MERGE) -</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </UiSelect>
        </div>
      </template>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>
  </form>
</template>
