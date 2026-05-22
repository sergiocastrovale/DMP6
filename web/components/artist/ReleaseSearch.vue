<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const model = defineModel<string>({ default: '' })

interface Props {
  placeholder: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search releases...',
})

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
    <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink0" />
    <input
      type="text"
      :placeholder="placeholder"
      class="h-8 w-full rounded-lg border border-rule bg-bg-1 pl-8 pr-3 text-sm text-ink placeholder:text-ink0 focus:border-accent focus:outline-none"
      @input="handleInput(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
