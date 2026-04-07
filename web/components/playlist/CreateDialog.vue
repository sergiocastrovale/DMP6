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
        <label class="mb-1 block text-sm text-zinc-400">Name</label>
        <input
          v-model="name"
          type="text"
          placeholder="My Playlist"
          autofocus
          required
          class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 outline-none focus:border-amber-500 transition-colors"
        >
      </div>
      <div>
        <label class="mb-1 block text-sm text-zinc-400">Description (optional)</label>
        <textarea
          v-model="description"
          placeholder="Add a description..."
          rows="3"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 outline-none focus:border-amber-500 transition-colors"
        />
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
          @click="show = false"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors disabled:opacity-50"
          :disabled="creating || !name.trim()"
        >
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
      </div>
    </form>
  </Dialog>
</template>
