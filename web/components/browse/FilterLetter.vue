<script setup lang="ts">
import { sw } from '~/helpers/ui'

defineProps<{
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
      type="button"
      :class="sw('keyChip', !active)"
      @click="emit('select', null)"
    >
      All
    </button>
    <button
      v-for="letter in letters"
      :key="letter"
      type="button"
      :class="sw('keyChip', active === letter.toLowerCase())"
      @click="emit('select', letter.toLowerCase())"
    >
      {{ letter }}
    </button>
  </div>
</template>
