<script setup lang="ts">
import type { Component } from 'vue'
import type { ButtonSize, ButtonVariant } from '~/types/ui'
import { cx, surface } from '~/helpers/ui'

// Wraps a download/merge/pause action so it disables itself the same way everywhere — artist page,
// /downloads' ApprovalQueue rows, and the /downloads header's pause/continue-all button — whenever
// this instance can't physically reach the download volume, the library folder, ffmpeg, or slskd.
// A hover popover names exactly what's missing instead of the action erroring after the click.
// `reasons` empty renders the plain action. `iconOnly` (default) renders a bare DataTableAction, as
// used inline in a row of actions; set it false for a full labelled UiButton (default slot = label).
const props = withDefaults(defineProps<{
  icon: Component
  label: string
  loading?: boolean
  reasons: string[]
  variant?: ButtonVariant
  iconClass?: string
  iconOnly?: boolean
  size?: ButtonSize
}>(), {
  iconOnly: true,
  size: 'sm',
})

defineEmits<{ click: [] }>()

const blocked = computed(() => props.reasons.length > 0)
</script>

<template>
  <DataTableAction
    v-if="iconOnly && !blocked"
    :icon="icon"
    :label="label"
    :loading="loading"
    :variant="variant"
    :icon-class="iconClass"
    @click="$emit('click')"
  />
  <UiButton
    v-else-if="!blocked"
    :size="size"
    :variant="variant ?? 'secondary'"
    :icon="icon"
    :icon-class="iconClass"
    :loading="loading"
    :title="label"
    @click="$emit('click')"
  >
    <slot>{{ label }}</slot>
  </UiButton>
  <Popover v-else trigger="hover" teleport :placement="iconOnly ? 'top-end' : 'bottom-start'">
    <template #trigger>
      <DataTableAction v-if="iconOnly" :icon="icon" :label="label" disabled variant="ghost" />
      <UiButton v-else :size="size" variant="secondary" :icon="icon" disabled>
        <slot>{{ label }}</slot>
      </UiButton>
    </template>
    <template #content>
      <div :class="cx(surface.popover, 'w-64 p-4')">
        <div class="mb-1 text-sm font-medium text-stone-100/80">Downloading is disabled</div>
        <ul class="mt-1 text-xs text-stone-100/60 list-disc pl-5">
          <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
        </ul>
      </div>
    </template>
  </Popover>
</template>
