<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const enabledId = useId()
const songkongId = useId()
const autoMergeId = useId()

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
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <SettingsMonitoringSources />

    <DownloadsAcquisitionIdleBanner />

    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Auto-monitoring</h2>
      <p class="text-sm text-stone-100/55">
        Leave a field blank to use the environment default. Changes apply live (no restart),
        except the base reconcile tick (RECONCILE_SEC, env only).
      </p>

      <div class="flex flex-col gap-1.5">
        <label :for="enabledId" class="block text-base font-medium text-stone-100">Monitoring</label>
        <p class="text-sm text-stone-100/55">Master switch for the download + catalogue loops.</p>
        <div class="relative">
          <select
            :id="enabledId"
            v-model="enabledChoice"
            class="h-[40px] w-full pl-[13px] pr-8 rounded-md bg-stone-950 border border-stone-100/10 text-stone-100 text-base font-sans appearance-none outline-0 transition-colors duration-150 focus:border-amber-400/45"
          >
            <option value="default">- use env default (MONITOR_ENABLED) -</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <ChevronDown :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-100/50" />
        </div>
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

      <div class="flex flex-col gap-1.5">
        <label :for="songkongId" class="block text-base font-medium text-stone-100">SongKong enrichment</label>
        <p class="text-sm text-stone-100/55">
          Enrich finished downloads (AcoustID, MusicBrainz IDs, genres, cover art) before the library
          folder layout is applied. Requires the host SongKong drainer cron. (SONGKONG_ENABLED)
        </p>
        <div class="relative">
          <select
            :id="songkongId"
            v-model="songkongChoice"
            class="h-[40px] w-full pl-[13px] pr-8 rounded-md bg-stone-950 border border-stone-100/10 text-stone-100 text-base font-sans appearance-none outline-0 transition-colors duration-150 focus:border-amber-400/45"
          >
            <option value="default">- use env default (SONGKONG_ENABLED) -</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <ChevronDown :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-100/50" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label :for="autoMergeId" class="block text-base font-medium text-stone-100">Auto-merge into library</label>
        <p class="text-sm text-stone-100/55">
          When on, ready downloads are merged into the music library automatically (no manual
          “Merge”). Off by default — merging stays a manual gate. (AUTO_MERGE)
        </p>
        <div class="relative">
          <select
            :id="autoMergeId"
            v-model="autoMergeChoice"
            class="h-[40px] w-full pl-[13px] pr-8 rounded-md bg-stone-950 border border-stone-100/10 text-stone-100 text-base font-sans appearance-none outline-0 transition-colors duration-150 focus:border-amber-400/45"
          >
            <option value="default">- use env default (AUTO_MERGE) -</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <ChevronDown :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-100/50" />
        </div>
      </div>
    </div>

    <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
  </div>
</template>
