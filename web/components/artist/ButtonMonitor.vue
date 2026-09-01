<script setup lang="ts">
import { Radar } from 'lucide-vue-next'

withDefaults(defineProps<{ monitored?: boolean; busy: boolean }>(), { monitored: false })
defineEmits<{ toggle: [] }>()
</script>

<template>
  <UiButton
    :variant="monitored ? 'primary' : 'secondary'"
    size="sm"
    :icon="Radar"
    :loading="busy"
    :title="monitored
      ? 'Monitoring: missing releases are downloaded automatically. Click to stop.'
      : 'Start monitoring: auto-download missing releases into the approval queue.'"
    @click="$emit('toggle')"
  >
    Monitor {{ monitored ? 'ON' : 'OFF' }}
  </UiButton>
</template>
