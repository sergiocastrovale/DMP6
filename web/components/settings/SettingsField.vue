<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { form } from '~/helpers/ui'

defineProps<{
  label: string
  description?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'select'
  options?: { value: string; label: string }[]
}>()

const model = defineModel<string | number | null>()

const fieldId = useId()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" :class="form.label">{{ label }}</label>
    <p v-if="description" class="text-sm text-stone-100/55">{{ description }}</p>

    <div v-if="type === 'select' && options" class="relative">
      <select
        :id="fieldId"
        v-model="model"
        :class="form.select"
      >
        <option value="">- use env default -</option>
        <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <ChevronDown :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-100/50" />
    </div>

    <input
      v-else
      :id="fieldId"
      v-model="model"
      :type="type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'"
      :placeholder="placeholder"
      :class="form.input"
    >
  </div>
</template>
