<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const fanartApiKey = ref(settings.value?.fanartApiKey ?? '')

const saving = ref(false)
const saved = ref(false)
const error = ref('')

async function save() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    await $fetch('/api/settings', {
      method: 'PUT',
      body: { fanartApiKey: fanartApiKey.value || null },
    })
    await refresh()
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  }
  catch (e: any) {
    error.value = e?.message || 'Save failed'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Fanart.tv</h2>
      <SettingsField
        label="API Key"
        description="Used by the sync script to fetch artist images. Overrides FANART_API_KEY."
        type="password"
        placeholder="••••••••"
        v-model="fanartApiKey"
      />
    </div>

    <div class="flex items-center gap-3">
      <button
        :disabled="saving"
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
