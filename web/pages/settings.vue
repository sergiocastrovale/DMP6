<script setup lang="ts">
import { Settings } from 'lucide-vue-next'

useHead({ title: 'Settings' })
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 pb-32">
    <div class="mb-8 flex items-center gap-3">
      <Settings :size="28" class="text-amber-500" />
      <div>
        <h1 class="text-2xl font-bold text-zinc-50">Settings</h1>
        <p class="text-sm text-zinc-400">Library management and scanning</p>
      </div>
    </div>

    <RealTimeStatus />
  </div>
</template>
