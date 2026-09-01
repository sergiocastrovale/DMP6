<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'

defineProps<{ artistName: string }>()

const open = ref(false)
</script>

<template>
  <UiButton
    variant="secondary"
    size="sm"
    :icon="Trash2"
    title="Remove this artist from the catalogue, optionally deleting their files"
    @click="open = true"
  >
    Remove
  </UiButton>
  <ArtistDeleteDialog v-model="open" :artist-name="artistName" />
</template>
