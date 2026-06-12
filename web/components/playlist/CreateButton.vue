<script setup lang="ts">
import { LucidePlus } from 'lucide-vue-next'

defineEmits<{ click: [] }>()
</script>

<template>
  <UiButton :icon="LucidePlus" @click="$emit('click')">
    New Playlist
  </UiButton>
</template>
