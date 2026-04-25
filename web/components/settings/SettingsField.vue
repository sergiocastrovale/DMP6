<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'select'
  options?: { value: string; label: string }[]
}>()

const model = defineModel<string | number | null>()
</script>

<template>
  <div class="space-y-1.5">
    <label class="block text-sm font-medium text-zinc-200">{{ label }}</label>
    <p v-if="description" class="text-xs text-zinc-500">{{ description }}</p>

    <select
      v-if="type === 'select' && options"
      v-model="model"
      class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
    >
      <option value="">— use env default —</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>

    <input
      v-else
      v-model="model"
      :type="type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'"
      :placeholder="placeholder"
      class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
    />
  </div>
</template>
