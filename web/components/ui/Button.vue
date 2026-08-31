<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'
import { button, cx, ICON_STROKE_WIDTH } from '~/helpers/ui'
import type { ButtonSize, ButtonVariant } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  iconOnly?: boolean
  icon?: Component
  trailingIcon?: Component
  iconClass?: string
  block?: boolean
  on?: boolean
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
  on: false,
  type: 'button',
})

const ICON_PX: Record<ButtonSize, number> = { sm: 13, md: 14, lg: 16, xl: 22 }
const ICON_ONLY_PX: Record<ButtonSize, number> = { sm: 15, md: 16, lg: 18, xl: 26 }

const isDisabled = computed(() => props.disabled || props.loading)
const isLink = computed(() => !!props.to || !!props.href)
const tag = computed(() => (props.to ? resolveComponent('NuxtLink') : props.href ? 'a' : 'button'))
const iconSize = computed(() => (props.iconOnly ? ICON_ONLY_PX[props.size] : ICON_PX[props.size]))

const classes = computed(() => cx(
  button(props.variant, props.size, '', props.on, props.iconOnly),
  props.block && 'w-full',
  isLink.value && isDisabled.value && 'pointer-events-none opacity-40',
))
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
    :aria-busy="loading || undefined"
    :aria-pressed="on || undefined"
    :aria-label="ariaLabel"
  >
    <Loader2 v-if="loading" :size="iconSize" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
    <component :is="icon" v-else-if="icon" :size="iconSize" :stroke-width="ICON_STROKE_WIDTH" :class="iconClass" />
    <slot v-if="!iconOnly" />
    <component :is="trailingIcon" v-if="trailingIcon && !iconOnly && !loading" :size="iconSize" :stroke-width="ICON_STROKE_WIDTH" :class="iconClass" />
  </component>
</template>
