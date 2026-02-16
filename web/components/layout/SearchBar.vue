<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

const query = ref('')
const inputRef = ref<HTMLInputElement>()

function clear() {
  query.value = ''
  inputRef.value?.focus()
}
</script>

<template>
  <div class="relative w-full max-w-md">
    <div class="relative">
      <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Search artists, releases, tracks..."
        class="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-9 pr-8 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
      <button
        v-if="query"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        @click="clear"
      >
        <X :size="14" />
      </button>
    </div>
  </div>
</template>
