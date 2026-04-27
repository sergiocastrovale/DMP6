<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const musicDir = ref(settings.value?.musicDir ?? '')

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: { musicDir: musicDir.value || null },
  })
  await refresh()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Music Library</h2>

      <SettingsField
        label="Music Directory"
        description="Absolute path to your music library root. Overrides MUSIC_DIR env var. Used by index script and audio streaming."
        placeholder="/path/to/your/music"
        v-model="musicDir"
      />

      <div class="flex items-center gap-3 pt-2">
        <button
          :disabled="saving"
          @click="save"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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

    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Scan Controls</h2>
      <RealTimeStatus />
    </div>
  </div>
</template>
