<script setup lang="ts">
import { LockOpen } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()
const { isAdmin } = useAuth()
const confirmOpen = ref(false)

const confirmUnlock = () => {
  confirmOpen.value = false
  terminal.unlockAndRerun()
}
</script>

<template>
  <div v-if="isAdmin && terminal.hasLockError">
    <UiButton
      variant="danger"
      size="sm"
      :icon="LockOpen"
      @click="confirmOpen = true"
    >
      Force unlock
    </UiButton>

    <ConfirmDialog
      v-model="confirmOpen"
      title="Run alongside the locked script?"
      message="Another script still holds the scan lock. Unlocking does not stop it - this run starts in parallel."
      note="Both scripts touch the same database at once. This can collide (lost updates, races on shared rows) - accepted risk of proceeding."
      confirm-label="Unlock and run script in parallel"
      variant="danger"
      :icon="LockOpen"
      @confirm="confirmUnlock"
    />
  </div>
</template>
