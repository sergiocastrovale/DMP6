<script setup lang="ts">
import { LockOpen } from 'lucide-vue-next'

const emit = defineEmits<{ unlocked: [] }>()

const unlocking = ref(false)

const forceUnlock = async () => {
  unlocking.value = true
  try {
    await $fetch('/api/scan/unlock', { method: 'POST' })
    emit('unlocked')
  }
  catch (e) {
    console.error('Force unlock failed:', e)
  }
  finally {
    unlocking.value = false
  }
}
</script>

<template>
  <UiButton
    variant="quiet"
    size="sm"
    :icon="LockOpen"
    :loading="unlocking"
    :disabled="unlocking"
    @click="forceUnlock"
  >
    Force Unlock
  </UiButton>
</template>
