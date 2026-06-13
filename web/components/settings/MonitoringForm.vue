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
  monitorIntervalMin: num(settings.value?.monitorIntervalMin),
  monitorCap: num(settings.value?.monitorCap),
  monitorGapsHours: num(settings.value?.monitorGapsHours),
  monitorRetryHours: num(settings.value?.monitorRetryHours),
  noProgressSec: num(settings.value?.noProgressSec),
  maxDownloadAttempts: num(settings.value?.maxDownloadAttempts),
})

// Tri-state enabled: default (env) / on / off
const enabledChoice = ref<'default' | 'on' | 'off'>(
  form.monitorEnabled === null || form.monitorEnabled === undefined ? 'default' : form.monitorEnabled ? 'on' : 'off',
)
const songkongChoice = ref<'default' | 'on' | 'off'>(
  settings.value?.songkongEnabled === null || settings.value?.songkongEnabled === undefined
    ? 'default'
    : settings.value.songkongEnabled ? 'on' : 'off',
)

const toNull = (v: string) => v === '' ? null : Number(v)

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      monitorEnabled: enabledChoice.value === 'default' ? null : enabledChoice.value === 'on',
      songkongEnabled: songkongChoice.value === 'default' ? null : songkongChoice.value === 'on',
      monitorIntervalMin: toNull(form.monitorIntervalMin),
      monitorCap: toNull(form.monitorCap),
      monitorGapsHours: toNull(form.monitorGapsHours),
      monitorRetryHours: toNull(form.monitorRetryHours),
      noProgressSec: toNull(form.noProgressSec),
      maxDownloadAttempts: toNull(form.maxDownloadAttempts),
    },
  })
  await refresh()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Auto-monitoring</h2>
      <p class="text-xs text-ink0">
        Leave a field blank to use the environment default. Changes apply live (no restart),
        except the base reconcile tick (RECONCILE_SEC, env only).
      </p>

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-ink">Monitoring</label>
        <p class="text-xs text-ink0">Master switch for the download + catalogue loops.</p>
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
        label="Download interval (minutes)"
        description="How often the download cycle runs. Default 15. (MONITOR_INTERVAL_MIN)"
        type="number" placeholder="15"
        v-model="form.monitorIntervalMin"
      />
      <SettingsField
        label="Per-cycle cap"
        description="Max releases queued per download cycle. Default 10. (MONITOR_CAP)"
        type="number" placeholder="10"
        v-model="form.monitorCap"
      />
      <SettingsField
        label="Catalogue refresh (hours)"
        description="How often monitored artists' MusicBrainz catalogue is refreshed for new releases. Default 24. (MONITOR_GAPS_HOURS)"
        type="number" placeholder="24"
        v-model="form.monitorGapsHours"
      />
      <SettingsField
        label="Failed retry cooldown (hours)"
        description="Wait this long before retrying a failed release. Default 12. (MONITOR_RETRY_HOURS)"
        type="number" placeholder="12"
        v-model="form.monitorRetryHours"
      />
      <SettingsField
        label="No-progress timeout (seconds)"
        description="Kill a download making no byte progress for this long. Default 60. (NO_PROGRESS_SEC)"
        type="number" placeholder="60"
        v-model="form.noProgressSec"
      />
      <SettingsField
        label="Max attempts before giving up"
        description="After this many failed attempts a release is abandoned (never auto-retried). Default 3. (MAX_DOWNLOAD_ATTEMPTS)"
        type="number" placeholder="3"
        v-model="form.maxDownloadAttempts"
      />

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-ink">SongKong enrichment</label>
        <p class="text-xs text-ink0">
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
