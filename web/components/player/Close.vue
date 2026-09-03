<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
</script>

<template>
  <div
    class="text-stone-100/60 cursor-pointer"
    title="Dismiss player"
    @click="player.dismiss()"
  >
    <X :size="16" />
  </div>
</template>