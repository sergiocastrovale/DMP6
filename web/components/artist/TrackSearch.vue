<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const model = defineModel<string>({ default: '' })

let searchTimeout: ReturnType<typeof setTimeout>
function handleInput(value: string) {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    model.value = value
  }, 300)
}
</script>

<template>
  <div class="relative flex-1 sm:max-w-xs">
    <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
    <input
      type="text"
      placeholder="Search tracks..."
      class="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-8 pr-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
      @input="handleInput(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
