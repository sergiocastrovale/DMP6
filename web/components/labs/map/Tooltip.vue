<script setup lang="ts">
defineProps<{
  x: number
  y: number
  name: string
  count: number
}>()
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed z-[2000] rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 shadow-lg"
      :style="{ left: `${x + 12}px`, top: `${y - 10}px` }"
    >
      <div class="text-base font-semibold text-stone-100">{{ name }}</div>
      <div v-if="count > 0" class="text-sm text-stone-100/60">
        {{ count }} {{ count === 1 ? 'artist' : 'artists' }}
      </div>
      <div v-else class="text-sm text-stone-100/55">No artists</div>
    </div>
  </Teleport>
</template>
