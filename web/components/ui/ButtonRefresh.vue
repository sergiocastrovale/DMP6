<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { scanSessionName } from '~/helpers/functions'

const props = defineProps<{ only?: string[]; folders?: string[] }>()
const terminal = useTerminalStore()

const sessionName = computed(() => scanSessionName('refresh', (props.only ?? []).join('-')))

async function run() {
  const session = sessionName.value
  if (props.folders?.length && props.only?.length) {
    await terminal.run('./index', ['--folders', props.folders.join(';')], session)
    await terminal.run('./sync', ['--only', props.only.join(';'), '--exact'], session)
  } else {
    const args = props.only?.length ? ['--only', props.only.join(';'), '--exact'] : []
    await terminal.run('./refresh', args, session)
  }
}
</script>

<template>
  <UiButton
    variant="secondary"
    size="sm"
    :icon="RefreshCw"
    :loading="terminal.isRunning"
    :title="only?.length ? `Re-index + Re-sync: ${only.join(', ')}` : 'Re-index + Re-sync all'"
    @click="run"
  >
    Re-index + Re-sync
    <span v-if="only?.length" class="text-xs text-stone-100/55">({{ only.length }})</span>
  </UiButton>
</template>
