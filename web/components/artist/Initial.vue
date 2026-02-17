<script setup lang="ts">
interface Props {
  name: string
}

const props = defineProps<Props>()

const initial = computed(() => props.name.charAt(0).toUpperCase())
</script>

<template>
  <span>{{ initial }}</span>
</template>