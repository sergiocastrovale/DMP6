<script setup lang="ts">
interface Props {
  total: number
}

const props = defineProps<Props>()
</script>

<template>
  <span>{{ total.toLocaleString() }} tracks</span>
</template>
