<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const settingsStore = useSettingsStore()

const musicDir = ref(settings.value?.musicDir ?? '')
const showTerminal = ref(settingsStore.showTerminal)
const autoScanEnabled = ref(settings.value?.autoScanEnabled ?? false)
const autoScanIntervalHours = ref(String(settings.value?.autoScanIntervalHours ?? 12))

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      musicDir: musicDir.value || null,
      showTerminal: showTerminal.value,
      autoScanEnabled: autoScanEnabled.value,
      autoScanIntervalHours: autoScanIntervalHours.value === '' ? null : autoScanIntervalHours.value,
    },
  })
  await refresh()
  await settingsStore.load()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Music Library</h2>

      <SettingsField
        v-model="musicDir"
        label="Music Directory"
        description="Absolute path to your music library root. Overrides MUSIC_DIR env var. Used by index script and audio streaming."
        placeholder="/path/to/your/music"
      />

      <div class="space-y-1.5">
        <Switch v-model="autoScanEnabled" label="Scan automatically" />
        <p class="text-xs text-ink-3">
          Runs index + sync unattended so new folders and releases appear without pressing anything.
          Only the instance started with MONITOR_PRIMARY=true runs it.
        </p>
      </div>

      <SettingsField
        v-if="autoScanEnabled"
        v-model="autoScanIntervalHours"
        label="Automatic scan interval (hours)"
        description="Minimum hours between unattended scans. Minimum 1."
        placeholder="12"
      />

      <div class="space-y-1.5">
        <Switch v-model="showTerminal" label="Show terminal sidebar" />
        <p class="text-xs text-ink-3">
          Stream raw output in the terminal sidebar for scans, fixes and merges. When off, a compact progress
          panel is shown instead. Overrides the SHOW_TERMINAL env var.
        </p>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          :disabled="saving || !canEdit"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          @click="save"
        >
          <Save :size="15" />
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="saved" class="flex items-center gap-1.5 text-sm text-emerald-400">
          <CheckCircle2 :size="15" /> Saved
        </span>
        <span v-if="error" class="flex items-center gap-1.5 text-sm text-red-400">
          <AlertCircle :size="15" /> {{ error }}
        </span>
      </div>
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6">
      <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-ink-2">Scan Controls</h2>
      <RealTimeStatus />
    </div>
  </div>
</template>
