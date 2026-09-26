import type { Choice, MonitoringField } from '~/helpers/downloadSettingsForm'
import { buildDownloadSettingsBody, numberInput, triState } from '~/helpers/downloadSettingsForm'
import { validateField } from '~/helpers/settingsValidation'

// The downloads settings page: form state seeded from the stored row, per-field validation on blur, and autosave through
// PUT /api/settings. `settings` and `refresh` come from the component's own awaited useAsyncData (a composable that
// awaited it would lose the component instance for everything after).
export const useDownloadSettingsForm = (settings: Ref<Record<string, any> | null | undefined>, refresh: () => Promise<void>) => {
  const s = settings.value

  const form = reactive({
    slskdUrl: s?.slskdUrl ?? '',
    slskdApiKey: s?.slskdApiKey ?? '',
    downloadsPath: s?.downloadsPath ?? '',
    downloadDirTemplate: s?.downloadDirTemplate ?? '',
    downloadFormats: s?.downloadFormats ?? '',
    downloadMinBitrate: String(s?.downloadMinBitrate ?? 320),
  })

  const monitoring = reactive<Record<MonitoringField['key'], string>>({
    maxConcurrentDownloads: numberInput(s?.maxConcurrentDownloads),
    searchPicksPerInterval: numberInput(s?.searchPicksPerInterval),
    searchIntervalSec: numberInput(s?.searchIntervalSec),
    gapsPicksPerRun: numberInput(s?.gapsPicksPerRun),
    gapsIntervalMin: numberInput(s?.gapsIntervalMin),
    retryCooldownDays: numberInput(s?.retryCooldownDays),
    noProgressSec: numberInput(s?.noProgressSec),
    maxDownloadAttempts: numberInput(s?.maxDownloadAttempts),
  })

  const fieldErrors = reactive<Record<'slskdUrl' | MonitoringField['key'], string>>({
    slskdUrl: '',
    maxConcurrentDownloads: '',
    searchPicksPerInterval: '',
    searchIntervalSec: '',
    gapsPicksPerRun: '',
    gapsIntervalMin: '',
    retryCooldownDays: '',
    noProgressSec: '',
    maxDownloadAttempts: '',
  })

  // Tri-state: default (env) / on / off.
  const choices = reactive<Record<'downloadsEnabled' | 'flacToMp3' | 'monitorEnabled' | 'songkongEnabled' | 'autoMergeDownloads', Choice>>({
    downloadsEnabled: triState(s?.downloadsEnabled),
    flacToMp3: triState(s?.flacToMp3),
    monitorEnabled: triState(s?.monitorEnabled),
    songkongEnabled: triState(s?.songkongEnabled),
    autoMergeDownloads: triState(s?.autoMergeDownloads),
  })
  const flacToMp3Bitrate = ref(String(s?.flacToMp3Bitrate ?? 320))

  // Each master switch hides its own section's fields when explicitly turned off - "default"/"on" both leave them
  // visible since the feature may still be running via the env default.
  const downloadsFieldsVisible = computed(() => choices.downloadsEnabled !== 'off')
  const flacToMp3FieldsVisible = computed(() => choices.flacToMp3 !== 'off')
  const monitoringFieldsVisible = computed(() => choices.monitorEnabled !== 'off')

  const { saving, saved, error, save } = useFormSave(async () => {
    await $fetch('/api/settings', {
      method: 'PUT',
      body: buildDownloadSettingsBody({ form, monitoring, choices, flacToMp3Bitrate: flacToMp3Bitrate.value }),
    })
    await refresh()
  })

  const onTextBlur = (field: keyof typeof fieldErrors, schema: Parameters<typeof validateField>[0], value: string) => {
    fieldErrors[field] = validateField(schema, value)
    if (!fieldErrors[field]) { save() }
  }

  return {
    form, monitoring, fieldErrors, choices, flacToMp3Bitrate,
    downloadsFieldsVisible, flacToMp3FieldsVisible, monitoringFieldsVisible,
    saving, saved, error, save, onTextBlur,
  }
}
