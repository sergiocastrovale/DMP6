<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const props = defineProps<{ only?: string[]; folders?: string[] }>()
const terminal = useTerminalStore()

// A fixed session name made two rows resynced at once collide on the 409 hasUnfinishedRun guard.
// Must satisfy SESSION_NAME_RE (/^[a-zA-Z0-9_-]{1,32}$/) in server/utils/terminalCommand.ts.
const sessionName = computed(() => {
  const slug = (props.only ?? []).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `refresh-${slug}`.slice(0, 32).replace(/-+$/, '') : 'refresh'
})

// --exact on every --only: without it these are prefix matches, so resyncing "Air" also drags in
// Air Supply and Airbourne. Every other call site already passes it.
async function run() {
  terminal.open()
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
    <span v-if="only?.length" class="text-xs text-stone-100/40">({{ only.length }})</span>
  </UiButton>
</template>
