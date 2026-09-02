<script setup lang="ts">
import { positiveIntField, absolutePathField, validateField } from '~/helpers/settingsValidation'

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

const fieldErrors = reactive({ musicDir: '', autoScanIntervalHours: '' })

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

const onMusicDirBlur = () => {
  fieldErrors.musicDir = validateField(absolutePathField, musicDir.value)
  if (!fieldErrors.musicDir) {save()}
}

const onIntervalBlur = () => {
  fieldErrors.autoScanIntervalHours = validateField(positiveIntField, autoScanIntervalHours.value)
  if (!fieldErrors.autoScanIntervalHours) {save()}
}

const onAutoScanEnabledChange = (v: boolean) => {
  autoScanEnabled.value = v
  save()
}

const onShowTerminalChange = (v: boolean) => {
  showTerminal.value = v
  save()
}
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Music Library">
      <SettingsField
        v-model="musicDir"
        label="Music Directory"
        description="Absolute path to your music library root. Overrides MUSIC_DIR env var. Used by index script and audio streaming."
        placeholder="/path/to/your/music"
        :error="fieldErrors.musicDir"
        :disabled="!canEdit"
        @blur="onMusicDirBlur"
      />

      <div class="flex flex-col gap-1.5">
        <Switch :model-value="autoScanEnabled" label="Scan automatically" :disabled="!canEdit" @update:model-value="onAutoScanEnabledChange" />
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
        type="number"
        :error="fieldErrors.autoScanIntervalHours"
        :disabled="!canEdit"
        @blur="onIntervalBlur"
      />

      <div class="flex flex-col gap-1.5">
        <Switch :model-value="showTerminal" label="Show terminal sidebar" :disabled="!canEdit" @update:model-value="onShowTerminalChange" />
        <p class="text-sm text-stone-100/55">
          Stream raw output in the terminal sidebar for scans, fixes and merges. When off, a compact progress
          panel is shown instead. Overrides the SHOW_TERMINAL env var.
        </p>
      </div>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" class="pt-2" />
    </UiCard>

    <UiCard title="Scan Controls">
      <SettingsRealTimeStatus />
    </UiCard>
  </div>
</template>
