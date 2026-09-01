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
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <UiCard title="Fanart.tv">
      <SettingsField
        v-model="fanartApiKey"
        label="API Key"
        description="Used by the sync script to fetch artist images. Overrides FANART_API_KEY."
        type="password"
        placeholder="••••••••"
      />
      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
    </UiCard>
  </div>
</template>
