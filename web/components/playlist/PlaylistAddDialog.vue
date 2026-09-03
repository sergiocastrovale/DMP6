<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  trackId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'created': []
}>()

const name = ref('')
const saving = ref(false)
const error = ref('')

const slug = computed(() =>
  name.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
)

watch(() => props.modelValue, (open) => {
  if (open) {
    name.value = ''
    error.value = ''
  }
})

async function save() {
  if (!name.value.trim() || !slug.value) {
    error.value = 'Please enter a valid name'
    return
  }
  if (!props.trackId) {return}

  saving.value = true
  error.value = ''
  try {
    const res = await $fetch<any>('/api/playlists', {
      method: 'POST',
      body: { name: name.value.trim() },
    })
    await $fetch(`/api/playlists/${res.playlist.slug}/tracks`, {
      method: 'POST',
      body: { trackId: props.trackId },
    })
    emit('update:modelValue', false)
    emit('created')
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Failed to create playlist'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :model-value="modelValue" title="New Playlist" size="sm" @update:model-value="emit('update:modelValue', $event)">
    <template #content>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <UiTextField v-model="name" label="Name" placeholder="My playlist" autofocus :error="error" />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="emit('update:modelValue', false)">
            Cancel
          </UiButton>
          <UiButton type="submit" :loading="saving" :disabled="!name.trim()">
            Create
          </UiButton>
        </div>
      </form>
    </template>
  </Dialog>
</template>
