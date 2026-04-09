<script setup lang="ts">
defineProps<{
  empty?: boolean
}>()
</script>

<template>
  <div v-if="empty">
    <slot name="empty" />
  </div>
  <slot v-else />
</template>
