<script setup lang="ts">
import type { Component } from 'vue'
import { cx, ICON_STROKE_WIDTH, nav } from '~/helpers/ui'

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

const tag = computed(() => (props.to ? resolveComponent('NuxtLink') : 'button'))

const itemClass = computed(() => cx(
  nav.base,
  props.active ? nav.active : nav.idle,
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
    <span v-if="active" :class="cx('absolute top-2 bottom-2 w-0.5 rounded-full bg-amber-400', collapsed ? 'left-0' : '-left-2.25')" />
    <component :is="icon" :size="17" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0" />
    <span v-if="!collapsed" class="truncate flex-1 text-left">{{ label }}</span>
    <span
      v-if="!collapsed && count"
      :class="cx('font-mono text-sm tabular-nums', active ? 'text-amber-400/80' : 'text-stone-100/40')"
    >
      {{ formatCount(count) }}
    </span>
  </component>
</template>
