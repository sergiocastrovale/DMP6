<script setup lang="ts">
interface Props {
  plays: number
}

const props = defineProps<Props>()
</script>

<template>
  <span>{{ plays.toLocaleString() }} plays</span>
</template>
