<script setup lang="ts">
import type { Component } from 'vue'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  to?: string
  label: string
  icon: Component
  count?: number | null
  collapsed?: boolean
  active?: boolean
}>(), {
  to: undefined,
  count: null,
  collapsed: false,
  active: false,
})

defineEmits<{ click: [] }>()

const formatCount = (n: number) => n.toLocaleString()

// Resolved here, not inline in the template's `:is` expression: the SFC compiler hoists a
// template-literal `resolveComponent('NuxtLink')` call to module scope, outside any active
// component instance, where it can't find Nuxt's globally-registered NuxtLink and silently
// falls back to rendering a literal, unresolved <nuxtlink> tag. Calling it from a computed
// evaluated during the actual render pass (like ui/Button.vue already does) resolves correctly.
const tag = computed(() => (props.to ? resolveComponent('NuxtLink') : 'button'))

const itemClass = computed(() => cx(
  'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-lg font-normal whitespace-nowrap transition-colors duration-150',
  props.active ? 'bg-amber-400/20 text-amber-400 font-medium' : 'text-stone-100/60 hover:bg-stone-800 hover:text-stone-100',
  props.collapsed && 'justify-center px-0',
))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :type="to ? undefined : 'button'"
    :title="collapsed ? label : undefined"
    :aria-label="collapsed ? label : undefined"
    :aria-current="to && active ? 'page' : undefined"
    :class="itemClass"
    @click="!to && $emit('click')"
  >
    <span v-if="active" :class="cx('absolute top-2 bottom-2 w-0.5 rounded-full bg-amber-400', collapsed ? 'left-0' : 'left-[-9px]')" />
    <component :is="icon" :size="20" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0" />
    <span v-if="!collapsed" class="flex-1 truncate">{{ label }}</span>
    <span
      v-if="!collapsed && count !== null && count > 0"
      :class="cx('font-mono text-2xs tabular-nums', active ? 'text-amber-400/80' : 'text-stone-100/30')"
    >
      {{ formatCount(count) }}
    </span>
  </component>
</template>
