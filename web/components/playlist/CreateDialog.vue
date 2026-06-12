<script setup lang="ts">
const emit = defineEmits<{
  created: []
}>()

const show = defineModel<boolean>({ default: false })

const name = ref('')
const description = ref('')
const creating = ref(false)

watch(show, (open) => {
  if (open) {
    name.value = ''
    description.value = ''
  }
})

async function create() {
  if (!name.value.trim() || creating.value)
    return

  creating.value = true
  try {
    await $fetch('/api/playlists', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        description: description.value.trim() || undefined,
      },
    })
    show.value = false
    emit('created')
  }
  catch (error) {
    console.error('Failed to create playlist:', error)
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <Dialog :model-value="show" title="Create Playlist" max-width="sm" @update:model-value="show = $event">
    <form class="flex flex-col gap-4" @submit.prevent="create">
      <div>
        <label class="mb-1 block text-sm text-ink-2">Name</label>
        <input
          v-model="name"
          type="text"
          placeholder="My Playlist"
          autofocus
          required
          class="w-full rounded-lg border border-rule bg-bg-2 px-3 py-2 text-sm text-ink placeholder-ink-3 outline-none focus:border-accent transition-colors"
        >
      </div>
      <div>
        <label class="mb-1 block text-sm text-ink-2">Description (optional)</label>
        <textarea
          v-model="description"
          placeholder="Add a description..."
          rows="3"
          class="w-full rounded-lg border border-rule bg-bg-2 px-3 py-2 text-sm text-ink placeholder-ink-3 outline-none focus:border-accent transition-colors"
        />
      </div>
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="show = false">
          Cancel
        </UiButton>
        <UiButton type="submit" :loading="creating" :disabled="!name.trim()">
          Create
        </UiButton>
      </div>
    </form>
  </Dialog>
</template>
