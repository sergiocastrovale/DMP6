<script setup lang="ts">
import { grid } from '~/helpers/ui'
import { urlField, positiveIntField } from '~/helpers/settingsValidation'
import { bitrateOptions } from '~/helpers/constants'
import { MONITORING_FIELDS } from '~/helpers/downloadSettingsForm'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  useCookieFetch<Record<string, any>>('/api/settings'),
)

const {
  form, monitoring, fieldErrors, choices, flacToMp3Bitrate,
  downloadsFieldsVisible, flacToMp3FieldsVisible, monitoringFieldsVisible,
  saving, saved, error, save, onTextBlur,
} = useDownloadSettingsForm(settings, refresh)

// Plain (non-tri-state) selects: set the value, then save.
const onChoiceChange = (setter: (v: string) => void, v: string) => {
  setter(v)
  save()
}
</script>

<template>
  <form class="flex w-full max-w-7xl flex-col gap-6" @submit.prevent>
    <DownloadsAcquisitionIdleBanner />

    <UiCard title="Download Settings">
      <SettingsTriStateSelect
        v-model="choices.downloadsEnabled"
        label="Downloads enabled"
        description="Master switch for Soulseek acquisition."
        env="DOWNLOADS_ENABLED"
        :disabled="!canEdit"
        @change="save"
      />

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
          <UiSelect
            :model-value="form.downloadMinBitrate"
            label="Minimum Bitrate (kbps)"
            description="Minimum bitrate filter. Overrides DOWNLOAD_MIN_BITRATE."
            :disabled="!canEdit"
            @update:model-value="onChoiceChange(v => form.downloadMinBitrate = v, $event)"
          >
            <option v-for="b in bitrateOptions" :key="b" :value="String(b)">{{ b }} kbps</option>
          </UiSelect>
        </div>

        <p class="text-sm text-stone-100/55">
          Leave a field blank to use the environment default. Changes apply live (no restart).
        </p>
      </template>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="Conversion">
      <div :class="flacToMp3FieldsVisible ? grid.halfRow : undefined">
        <SettingsTriStateSelect
          v-model="choices.flacToMp3"
          label="Convert FLAC to MP3"
          description="Convert FLAC downloads to mp3 automatically. Deletes original FLAC files after converting. Overrides FLAC_TO_MP3."
          env="FLAC_TO_MP3"
          :disabled="!canEdit"
          @change="save"
        />

        <UiSelect
          v-if="flacToMp3FieldsVisible"
          :model-value="flacToMp3Bitrate"
          label="Conversion bitrate"
          description="Target kbps for the FLAC->MP3 conversion. Overrides FLAC_TO_MP3_BITRATE."
          :disabled="!canEdit"
          @update:model-value="onChoiceChange(v => flacToMp3Bitrate = v, $event)"
        >
          <option v-for="b in bitrateOptions" :key="b" :value="String(b)">{{ b }} kbps</option>
        </UiSelect>
      </div>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="Auto-monitoring">
      <SettingsTriStateSelect
        v-model="choices.monitorEnabled"
        label="Monitoring"
        description="Master switch for the download + catalogue loops."
        env="MONITOR_ENABLED"
        :disabled="!canEdit"
        @change="save"
      />

      <template v-if="monitoringFieldsVisible">
        <div :class="grid.halfRow">
          <SettingsField
            v-for="field in MONITORING_FIELDS"
            :key="field.key"
            v-model="monitoring[field.key]"
            :label="field.label"
            :description="field.description"
            type="number"
            :placeholder="field.placeholder"
            :error="fieldErrors[field.key]"
            :disabled="!canEdit"
            @blur="onTextBlur(field.key, positiveIntField, monitoring[field.key])"
          />
        </div>
      </template>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="SongKong enrichment">
      <SettingsTriStateSelect
        v-model="choices.songkongEnabled"
        label="SongKong enrichment"
        description="Enrich finished downloads (AcoustID, MusicBrainz IDs, genres, cover art) before the library folder layout is applied. Requires a dedicated, ephemeral SongKong Docker instance (its own config/DB - never the live GUI server) driven by a host cron that runs the drainer script every 2 minutes; DMP's bundled enrich-only profile (no rename/move) is deployed automatically, so SongKong only tags files - it never touches file placement. See docs/downloader/downloads_songkong.md for the full rebuild guide. Overrides SONGKONG_ENABLED."
        env="SONGKONG_ENABLED"
        :disabled="!canEdit"
        @change="save"
      />

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>

    <UiCard title="Auto-merge">
      <SettingsTriStateSelect
        v-model="choices.autoMergeDownloads"
        label="Auto-merge into library"
        description="When on, ready downloads are merged into the music library automatically (no manual “Merge”). Off by default — merging stays a manual gate. Overrides AUTO_MERGE."
        env="AUTO_MERGE"
        :disabled="!canEdit"
        @change="save"
      />
      <p class="text-sm text-stone-100/55">
        Merges into <span class="font-mono text-stone-100/70">{{ settings?.musicDir || 'MUSIC_DIR (not set)' }}</span>.
      </p>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>
  </form>
</template>
