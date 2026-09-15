<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'

defineEmits<{
  retry: []
}>()
</script>

<template>
  <UiEmptyState :icon="TriangleAlert" message="We are hitting MusicBrainz too much. Wait a bit and then try again.">
    <template #action>
      <UiButton variant="secondary" size="sm" @click="$emit('retry')">
        Retry
      </UiButton>
    </template>
  </UiEmptyState>
</template>
