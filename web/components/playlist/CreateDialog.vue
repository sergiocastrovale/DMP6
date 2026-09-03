<script setup lang="ts">
import { form } from '~/helpers/ui'

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
  if (!name.value.trim() || creating.value) {
    return
  }

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
  <Dialog :model-value="show" title="Create Playlist" size="sm" @update:model-value="show = $event">
    <template #content>
      <form class="flex flex-col gap-4" @submit.prevent="create">
        <UiTextField v-model="name" label="Name" placeholder="My Playlist" autofocus required />
        <div>
          <label :class="form.label" class="mb-1 block">Description (optional)</label>
          <textarea
            v-model="description"
            placeholder="Add a description..."
            rows="3"
            :class="[form.input, 'h-auto py-2.5']"
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
    </template>
  </Dialog>
</template>
