<script setup lang="ts">
// Shared shell for the fixed, bottom-of-viewport bulk-action bar used wherever a page lets the
// user select rows and act on all of them at once. One definition instead of four near-identical
// copies (issues/{SelectionBar,RevertSelectionBar,HistorySelectionBar}.vue, downloads/
// SelectionBar.vue - the last one moves onto this in its own stage) - each had drifted slightly,
// including a stale lg:left-56 offset from before the sidebar became 240px wide, and reacting to
// terminal.isOpen alone where the shell itself also checks settings.showTerminal (so a bar could
// reserve 500px of empty space on the right while the terminal drawer wasn't actually shown).
const props = withDefaults(defineProps<{
  count: number
  label?: string
}>(), {
  label: 'row',
})

const terminal = useTerminalStore()
const settings = useSettingsStore()
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="count > 0"
      class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-stone-100/6 bg-stone-900 px-6 py-3 transition-all duration-300 lg:left-60"
      :class="{ 'lg:right-[500px]': terminal.isOpen && settings.showTerminal }"
    >
      <span class="text-base text-stone-100/60">{{ count }} {{ label }}{{ count !== 1 ? 's' : '' }} selected</span>
      <div class="flex items-center gap-2">
        <slot />
      </div>
    </div>
  </Transition>
</template>
