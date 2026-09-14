<script setup lang="ts">
import { cx, sw } from '~/helpers/ui'

defineProps<{
  active: string | null
}>()

const emit = defineEmits<{
  select: [letter: string | null]
}>()

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
</script>

<template>
  <div class="flex flex-wrap gap-1 lg:grid lg:grid-cols-27">
    <button
      type="button"
      :class="cx(sw('keyChip', !active), 'lg:w-full lg:min-w-0 lg:px-0')"
      @click="emit('select', null)"
    >
      All
    </button>
    <button
      v-for="letter in letters"
      :key="letter"
      type="button"
      :class="cx(sw('keyChip', active === letter.toLowerCase()), 'lg:w-full lg:min-w-0 lg:px-0')"
      @click="emit('select', letter.toLowerCase())"
    >
      {{ letter }}
    </button>
  </div>
</template>
