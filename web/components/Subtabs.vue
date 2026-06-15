<script setup lang="ts">
interface SubtabItem {
  key: string
  label: string
  count?: number
  activeColor?: string
}

defineProps<{
  tabs: SubtabItem[]
}>()

const active = defineModel<string>()
</script>

<template>
  <div class="flex gap-1 border-b border-rule">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="px-4 py-2 text-sm font-medium transition-colors"
      :class="active === tab.key ? `border-b-2 ${tab.activeColor || 'border-blue-500'} text-white` : 'text-ink-3 hover:text-ink-2'"
      @click="active = tab.key"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined && tab.count > 0" class="ml-1.5 rounded-full bg-bg-2 px-1.5 py-0.5 text-xs">
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
