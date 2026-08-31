<script setup lang="ts">
const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const fanartApiKey = ref(settings.value?.fanartApiKey ?? '')

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: { fanartApiKey: fanartApiKey.value || null },
  })
  await refresh()
})
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Fanart.tv</h2>
      <SettingsField
        v-model="fanartApiKey"
        label="API Key"
        description="Used by the sync script to fetch artist images. Overrides FANART_API_KEY."
        type="password"
        placeholder="••••••••"
      />
    </div>

    <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
  </div>
</template>
