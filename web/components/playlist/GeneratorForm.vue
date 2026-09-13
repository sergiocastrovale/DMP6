<script setup lang="ts">
import { LucideArrowLeft } from 'lucide-vue-next'
import type { PlaylistGeneratorRow, PlaylistGeneratorType } from '~/types/playlistGenerator'
import { cx, layout, grid, form } from '~/helpers/ui'
import {
  parseTerms,
  termsToText,
  validateGenerator,
  GENERATOR_TERMS_LABEL,
  GENERATOR_TERMS_PLACEHOLDER,
  GENERATOR_TERMS_HINT,
} from '~/helpers/playlistGenerators'

const props = defineProps<{ id?: string }>()

const toast = useToastStore()
const isEdit = computed(() => !!props.id)

const loading = ref(!!props.id)
const type = ref<PlaylistGeneratorType>('GENRE')
const name = ref('')
const description = ref('')
const termsText = ref('')

if (props.id) {
  const { data: row } = await useAsyncData(`playlist-generator-${props.id}`, () =>
    $fetch<PlaylistGeneratorRow>(`/api/playlist-generators/${props.id}`))

  if (row.value) {
    type.value = row.value.type
    name.value = row.value.name
    description.value = row.value.description ?? ''
    termsText.value = termsToText(row.value.terms)
  }
  loading.value = false
}

const { saving, error, save: doSave } = useFormSave(async () => {
  const terms = parseTerms(termsText.value)
  const validationError = validateGenerator({ type: type.value, name: name.value, terms })
  if (validationError) {
    throw new Error(validationError)
  }

  const trimmedName = name.value.trim()
  const body = { type: type.value, name: trimmedName, description: description.value.trim() || undefined, terms }
  if (isEdit.value) {
    await $fetch(`/api/playlist-generators/${props.id}`, { method: 'PUT', body })
    toast.success(`Saved "${trimmedName}"`)
  }
  else {
    await $fetch('/api/playlist-generators', { method: 'POST', body })
    toast.success(`Added "${trimmedName}"`)
  }
  await navigateTo('/playlists/setup/generated')
})
</script>

<template>
  <div :class="cx(layout.page)">
    <UiButton variant="ghost" size="sm" :icon="LucideArrowLeft" to="/playlists/setup/generated" class="self-start">
      Back to generated playlists
    </UiButton>

    <PageTitle :text="isEdit ? `Edit ${name || 'playlist generator'}` : 'New playlist generator'" />

    <UiLoadingBlock v-if="loading" />

    <form v-else class="flex w-full max-w-7xl flex-col gap-6" @submit.prevent="doSave">
      <UiCard title="Details">
        <div :class="grid.halfRow">
          <UiSelect v-if="!isEdit" v-model="type" label="Type" description="Genre or region playlist. Fixed once created.">
            <option value="GENRE">Genre</option>
            <option value="REGION">Region</option>
          </UiSelect>
          <div v-else class="flex flex-col gap-1.5">
            <span :class="form.label">Type</span>
            <p :class="form.hint">Fixed once created.</p>
            <UiBadge :tone="type === 'GENRE' ? 'accent' : 'info'" class="mt-auto self-start">
              {{ type === 'GENRE' ? 'Genre' : 'Region' }}
            </UiBadge>
          </div>

          <UiTextField v-model="name" label="Name" placeholder="Rock" autofocus required />
        </div>

        <UiTextArea v-model="description" label="Description (optional)" placeholder="Classic and modern rock across all subgenres" />
      </UiCard>

      <UiCard title="Matching">
        <UiTextArea
          v-model="termsText"
          :label="GENERATOR_TERMS_LABEL[type]"
          :description="GENERATOR_TERMS_HINT[type]"
          :placeholder="GENERATOR_TERMS_PLACEHOLDER[type]"
          :rows="10"
          required
        />

        <SettingsSaveBar :saving="saving" :saved="false" :error="error">
          <UiButton variant="ghost" to="/playlists/setup/generated">
            Cancel
          </UiButton>
          <UiButton type="submit" :loading="saving">
            Save
          </UiButton>
        </SettingsSaveBar>
      </UiCard>
    </form>
  </div>
</template>
