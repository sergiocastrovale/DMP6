<script setup lang="ts">
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
  <div class="flex max-w-2xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Music Library</h2>

      <SettingsField
        v-model="musicDir"
        label="Music Directory"
        description="Absolute path to your music library root. Overrides MUSIC_DIR env var. Used by index script and audio streaming."
        placeholder="/path/to/your/music"
      />

      <div class="flex flex-col gap-1.5">
        <Switch v-model="autoScanEnabled" label="Scan automatically" />
        <p class="text-sm text-stone-100/55">
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

      <div class="flex flex-col gap-1.5">
        <Switch v-model="showTerminal" label="Show terminal sidebar" />
        <p class="text-sm text-stone-100/55">
          Stream raw output in the terminal sidebar for scans, fixes and merges. When off, a compact progress
          panel is shown instead. Overrides the SHOW_TERMINAL env var.
        </p>
      </div>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" label="Save" class="pt-2" @save="save" />
    </div>

    <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="mb-4 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Scan Controls</h2>
      <RealTimeStatus />
    </div>
  </div>
</template>
