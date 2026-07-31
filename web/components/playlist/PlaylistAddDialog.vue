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
  <Dialog :model-value="modelValue" title="New Playlist" max-width="sm" @update:model-value="emit('update:modelValue', $event)">
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <div>
        <label for="playlist-name" class="mb-1 block text-sm text-ink-2">Name</label>
        <input
          id="playlist-name"
          v-model="name"
          type="text"
          class="w-full rounded-lg border border-rule bg-bg-2 px-3 py-2 text-sm text-ink placeholder-ink-3 outline-none focus:border-accent transition-colors"
          placeholder="My playlist"
          autofocus
        >
      </div>
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-2 hover:bg-bg-2 transition-colors"
          @click="emit('update:modelValue', false)"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="saving || !name.trim()"
        >
          {{ saving ? 'Creating...' : 'Create' }}
        </button>
      </div>
    </form>
  </Dialog>
</template>
