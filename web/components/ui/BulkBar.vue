<script setup lang="ts">
// The one bulk-action bar. It sits IN FLOW, directly above the table it acts on - not pinned to the
// viewport - so the selection count reads next to the rows it counts and the actions land where the
// eye already is. It used to be `fixed bottom-0`, which put the count a full screen away from the
// checkboxes and needed a running tally of the sidebar width and the terminal drawer's state just to
// avoid covering them; DataTable.vue had quietly grown a second, in-flow copy rather than use it.
// This is that copy, promoted - there is now one definition again.
//
// `label` is optional on purpose: with none, the bar reads "3 selected", which is what every screen
// wants. Pass one only when the noun genuinely disambiguates ("3 artists selected").

import { cx, toneBg } from '~/helpers/ui'

withDefaults(defineProps<{
  count: number
  label?: string
}>(), {
  label: undefined,
})

// The bar owns its own Cancel: every reference screen ends the strip with one, and leaving it to
// each caller is how four near-identical copies drifted apart last time.
const emit = defineEmits<{ cancel: [] }>()
</script>

<template>
  <div
    v-if="count > 0"
    :class="cx('flex h-[42px] items-center justify-between gap-4 rounded-lg border border-amber-400/30 px-4 text-base', toneBg.accent)"
  >
    <span class="font-medium">
      {{ count }}{{ label ? ` ${label}${count !== 1 ? 's' : ''}` : '' }} selected
    </span>
    <div class="flex items-center gap-2">
      <slot />
      <UiButton variant="ghost" size="sm" @click="emit('cancel')">
        Cancel
      </UiButton>
    </div>
  </div>
</template>
