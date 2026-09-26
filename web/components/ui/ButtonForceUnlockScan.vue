<script setup lang="ts">
import { LockOpen } from 'lucide-vue-next'

const emit = defineEmits<{ unlocked: [] }>()

const { hasPerm } = useAuth()
const api = useApi()
const canUnlock = hasPerm('terminal.control')
const unlocking = ref(false)

const forceUnlock = async () => {
  unlocking.value = true
  try {
    await $fetch('/api/scan/unlock', { method: 'POST' })
    emit('unlocked')
  }
  catch (e) {
    api.report(e, 'Could not clear the scan lock')
  }
  finally {
    unlocking.value = false
  }
}
</script>

<template>
  <UiButton
    v-if="canUnlock"
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
