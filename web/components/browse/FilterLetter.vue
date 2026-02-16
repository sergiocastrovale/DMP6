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
      :class="!active ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-50'"
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
          ? 'bg-amber-500 text-zinc-950'
          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-50'
      "
      @click="emit('select', letter.toLowerCase())"
    >
      {{ letter }}
    </button>
  </div>
</template>
