<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  iconOnly?: boolean
  icon?: Component
  trailingIcon?: Component
  iconClass?: string
  block?: boolean
  type?: 'button' | 'submit' | 'reset'
  to?: RouteLocationRaw
  href?: string
  ariaLabel?: string
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  iconOnly: false,
  block: false,
  type: 'button',
})

const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90',
  secondary: 'border border-rule bg-bg-1 text-ink-2 hover:border-ink-4 hover:bg-bg-2 hover:text-ink',
  ghost: 'text-ink-2 hover:bg-bg-2 hover:text-ink',
  danger: 'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20',
}

const textSizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
}

const iconOnlySizes: Record<Size, string> = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-2.5',
}

const iconPx: Record<Size, number> = {
  sm: 14,
  md: 16,
  lg: 18,
}

const iconOnlyPx: Record<Size, number> = {
  sm: 16,
  md: 18,
  lg: 20,
}

const isDisabled = computed(() => props.disabled || props.loading)

const tag = computed(() => (props.to ? resolveComponent('NuxtLink') : props.href ? 'a' : 'button'))

const isLink = computed(() => !!props.to || !!props.href)

const iconSize = computed(() => (props.iconOnly ? iconOnlyPx[props.size] : iconPx[props.size]))

const classes = computed(() => [
  base,
  variants[props.variant],
  props.iconOnly ? iconOnlySizes[props.size] : textSizes[props.size],
  props.block && 'w-full',
  isLink.value && isDisabled.value && 'pointer-events-none opacity-50',
])
</script>

<template>
  <component
    :is="tag"
    :class="classes"
    :type="isLink ? undefined : type"
    :to="to"
    :href="href"
    :disabled="isLink ? undefined : isDisabled"
    :aria-disabled="isLink && isDisabled ? 'true' : undefined"
    :aria-label="ariaLabel"
  >
    <Loader2 v-if="loading" :size="iconSize" class="animate-spin" />
    <component :is="icon" v-else-if="icon" :size="iconSize" :class="iconClass" />
    <slot v-if="!iconOnly" />
    <component :is="trailingIcon" v-if="trailingIcon && !iconOnly && !loading" :size="iconSize" :class="iconClass" />
  </component>
</template>
