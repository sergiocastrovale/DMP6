<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-monitoring', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

// Empty string = "use env default" (sent as null). Numbers kept as strings in the inputs.
const num = (v: any) => (v ?? '') === '' ? '' : String(v)
const form = reactive({
  monitorEnabled: settings.value?.monitorEnabled ?? null as boolean | null,
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
const enabledChoice = ref(triState(form.monitorEnabled))
const songkongChoice = ref(triState(settings.value?.songkongEnabled))
const autoMergeChoice = ref(triState(settings.value?.autoMergeDownloads))

const toNull = (v: string) => v === '' ? null : Number(v)
const fromChoice = (c: 'default' | 'on' | 'off') => c === 'default' ? null : c === 'on'

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      monitorEnabled: fromChoice(enabledChoice.value),
      songkongEnabled: fromChoice(songkongChoice.value),
      autoMergeDownloads: fromChoice(autoMergeChoice.value),
      maxConcurrentDownloads: toNull(form.maxConcurrentDownloads),
      searchPicksPerInterval: toNull(form.searchPicksPerInterval),
      searchIntervalSec: toNull(form.searchIntervalSec),
      gapsPicksPerRun: toNull(form.gapsPicksPerRun),
      gapsIntervalMin: toNull(form.gapsIntervalMin),
      retryCooldownDays: toNull(form.retryCooldownDays),
      noProgressSec: toNull(form.noProgressSec),
      maxDownloadAttempts: toNull(form.maxDownloadAttempts),
    },
  })
  await refresh()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <SettingsMonitoringSources />

    <DownloadsAcquisitionIdleBanner />

    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Auto-monitoring</h2>
      <p class="text-xs text-ink-3">
        Leave a field blank to use the environment default. Changes apply live (no restart),
        except the base reconcile tick (RECONCILE_SEC, env only).
      </p>

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-ink">Monitoring</label>
        <p class="text-xs text-ink-3">Master switch for the download + catalogue loops.</p>
        <select
          v-model="enabledChoice"
          class="w-full rounded border border-rule bg-bg-2 px-3 py-2 text-sm text-ink focus:border-blue-500 focus:outline-none"
        >
          <option value="default">- use env default (MONITOR_ENABLED) -</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>

      <SettingsField
        v-model="form.maxConcurrentDownloads"
        label="Max concurrent downloads"
        description="Cap on simultaneous active Soulseek transfers. The worker tops up to this. Default 5. (MAX_CONCURRENT_DOWNLOADS)" type="number"
        placeholder="5"
      />
      <SettingsField
        v-model="form.searchPicksPerInterval"
        label="Search picks per interval"
        description="How many new missing releases the worker searches each top-up. Default 3. (SEARCH_PICKS_PER_INTERVAL)" type="number"
        placeholder="3"
      />
      <SettingsField
        v-model="form.searchIntervalSec"
        label="Search interval (seconds)"
        description="Minimum seconds between download top-up runs (throttle). Default 60. (SEARCH_INTERVAL_SEC)" type="number"
        placeholder="60"
      />
      <SettingsField
        v-model="form.gapsPicksPerRun"
        label="Catalogue-gap picks per run"
        description="Monitored artists whose MusicBrainz catalogue is refreshed each gap run (round-robin). Default 20. (GAPS_PICKS_PER_RUN)" type="number"
        placeholder="20"
      />
      <SettingsField
        v-model="form.gapsIntervalMin"
        label="Catalogue-gap interval (minutes)"
        description="Minutes between catalogue-gap runs. Default 5. (GAPS_INTERVAL_MIN)" type="number"
        placeholder="5"
      />
      <SettingsField
        v-model="form.retryCooldownDays"
        label="Retry cooldown (days)"
        description="Wait this many days before retrying a FAILED/UNAVAILABLE/INVALID release. Default 7. (RETRY_COOLDOWN_DAYS)" type="number"
        placeholder="7"
      />
      <SettingsField
        v-model="form.noProgressSec"
        label="No-progress timeout (seconds)"
        description="Kill a download making no byte progress for this long. Default 60. (NO_PROGRESS_SEC)" type="number"
        placeholder="60"
      />
      <SettingsField
        v-model="form.maxDownloadAttempts"
        label="Max attempts before giving up"
        description="After this many failed attempts a release is abandoned (never auto-retried). Default 3. (MAX_DOWNLOAD_ATTEMPTS)" type="number"
        placeholder="3"
      />

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-ink">SongKong enrichment</label>
        <p class="text-xs text-ink-3">
          Enrich finished downloads (AcoustID, MusicBrainz IDs, genres, cover art) before the library
          folder layout is applied. Requires the host SongKong drainer cron. (SONGKONG_ENABLED)
        </p>
        <select
          v-model="songkongChoice"
          class="w-full rounded border border-rule bg-bg-2 px-3 py-2 text-sm text-ink focus:border-blue-500 focus:outline-none"
        >
          <option value="default">- use env default (SONGKONG_ENABLED) -</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-ink">Auto-merge into library</label>
        <p class="text-xs text-ink-3">
          When on, ready downloads are merged into the music library automatically (no manual
          “Merge”). Off by default — merging stays a manual gate. (AUTO_MERGE)
        </p>
        <select
          v-model="autoMergeChoice"
          class="w-full rounded border border-rule bg-bg-2 px-3 py-2 text-sm text-ink focus:border-blue-500 focus:outline-none"
        >
          <option value="default">- use env default (AUTO_MERGE) -</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
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
