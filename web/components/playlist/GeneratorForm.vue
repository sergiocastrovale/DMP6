<script setup lang="ts">
import { LucideArrowLeft } from 'lucide-vue-next'
import type { PlaylistGeneratorRow, PlaylistGeneratorType } from '~/types/playlistGenerator'
import { cx, layout, form } from '~/helpers/ui'
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
const saving = ref(false)
const error = ref('')

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

const save = async () => {
  error.value = ''
  const terms = parseTerms(termsText.value)
  const validationError = validateGenerator({ type: type.value, name: name.value, terms })
  if (validationError) {
    error.value = validationError
    return
  }

  saving.value = true
  try {
    const body = { type: type.value, name: name.value.trim(), description: description.value.trim() || undefined, terms }
    if (isEdit.value) {
      await $fetch(`/api/playlist-generators/${props.id}`, { method: 'PUT', body })
      toast.success(`Saved "${name.value.trim()}"`)
    }
    else {
      await $fetch('/api/playlist-generators', { method: 'POST', body })
      toast.success(`Added "${name.value.trim()}"`)
    }
    await navigateTo('/playlists/setup/generated')
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || e?.data?.message || 'Failed to save playlist generator'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div :class="cx(layout.page)">
    <UiButton variant="ghost" size="sm" :icon="LucideArrowLeft" to="/playlists/setup/generated" class="self-start">
      Back to generated playlists
    </UiButton>

    <PageTitle :text="isEdit ? `Edit ${name || 'playlist generator'}` : 'New playlist generator'" />

    <UiLoadingBlock v-if="loading" />

    <form v-else class="flex max-w-xl flex-col gap-4" @submit.prevent="save">
      <UiSelect v-if="!isEdit" v-model="type" label="Type">
        <option value="GENRE">Genre</option>
        <option value="REGION">Region</option>
      </UiSelect>
      <div v-else class="flex flex-col gap-1.5">
        <span :class="form.label">Type</span>
        <UiBadge :tone="type === 'GENRE' ? 'accent' : 'info'" class="self-start">
          {{ type === 'GENRE' ? 'Genre' : 'Region' }}
        </UiBadge>
      </div>

      <UiTextField v-model="name" label="Name" placeholder="Rock" autofocus required />
      <UiTextArea v-model="description" label="Description (optional)" placeholder="Classic and modern rock across all subgenres" />

      <UiTextArea
        v-model="termsText"
        :label="GENERATOR_TERMS_LABEL[type]"
        :description="GENERATOR_TERMS_HINT[type]"
        :placeholder="GENERATOR_TERMS_PLACEHOLDER[type]"
        :rows="10"
        required
      />

      <p v-if="error" role="alert" :class="form.error">{{ error }}</p>

      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" to="/playlists/setup/generated">
          Cancel
        </UiButton>
        <UiButton type="submit" :loading="saving">
          Save
        </UiButton>
      </div>
    </form>
  </div>
</template>
