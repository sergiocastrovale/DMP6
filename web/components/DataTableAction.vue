<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { ButtonVariant } from '~/types/ui'

// The single look every row action across every data table shares: bare icon, no border/fill
// until hover. Destructive actions get no colour treatment either - the icon and label carry
// the meaning, not a red button, so the row stays visually uniform. `variant` is an escape
// hatch for the rare action that must stand out as primary (e.g. an immediate merge) - leave
// it unset everywhere else.
defineProps<{
  icon: Component
  label: string
  loading?: boolean
  disabled?: boolean
  to?: RouteLocationRaw
  href?: string
  on?: boolean
  iconClass?: string
  variant?: ButtonVariant
}>()
</script>

<template>
  <UiButton
    :variant="variant ?? 'ghost'"
    size="sm"
    icon-only
    :icon="icon"
    :icon-class="iconClass"
    :title="label"
    :aria-label="label"
    :loading="loading"
    :disabled="disabled"
    :to="to"
    :href="href"
    :on="on"
  />
</template>
