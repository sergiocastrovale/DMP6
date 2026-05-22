<script setup lang="ts">
const props = defineProps<{
  active: string | null
}>()

const emit = defineEmits<{
  select: [letter: string | null]
}>()

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
</script>

<template>
  <div class="flex flex-wrap gap-1">
    <button
      class="rounded px-2 py-1 text-xs font-medium transition-colors"
      :class="!active ? 'bg-accent text-accent-ink' : 'bg-bg-2 text-ink-2 hover:text-ink'"
      @click="emit('select', null)"
    >
      All
    </button>
    <button
      v-for="letter in letters"
      :key="letter"
      class="rounded px-2 py-1 text-xs font-medium transition-colors"
      :class="
        active === letter.toLowerCase()
          ? 'bg-accent text-accent-ink'
          : 'bg-bg-2 text-ink-2 hover:text-ink'
      "
      @click="emit('select', letter.toLowerCase())"
    >
      {{ letter }}
    </button>
  </div>
</template>
