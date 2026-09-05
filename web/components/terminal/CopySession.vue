<script setup lang="ts">
import { Copy } from 'lucide-vue-next'

const props = defineProps<{ session: string | null }>()

function copy() {
  navigator.clipboard.writeText(`tmux attach-session -t ${props.session}`)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="font-mono text-xs text-stone-100/55">
      tmux attach-session -t {{ session ?? '...' }}
    </span>
    <UiButton
      v-if="session"
      variant="ghost"
      size="sm"
      icon-only
      :icon="Copy"
      title="Copy"
      @click="copy"
    />
  </div>
</template>
