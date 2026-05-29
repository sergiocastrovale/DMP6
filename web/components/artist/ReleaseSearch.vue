<script setup lang="ts">
const model = defineModel<string>({ default: '' })

const props = withDefaults(defineProps<{
  placeholder?: string
}>(), {
  placeholder: 'Search releases...',
})
</script>

<template>
  <SearchInput
    :model-value="model"
    :placeholder="placeholder"
    :debounce="300"
    wrapper-class="flex-1 sm:max-w-xs"
    @update:model-value="model = $event"
  />
</template>
