import type { IssueType } from '~/types/issues'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'

// Queueing fixes and reverts for the selected rows of an issue type, running `./fix` in the terminal, and refreshing the
// lists once that run finished cleanly.
export const useIssueFixes = (type: () => IssueType) => {
  const issuesStore = useIssuesStore()
  const terminal = useTerminalStore()

  const selected = ref<Set<string>>(new Set())
  const selectedResolved = ref<Set<string>>(new Set())
  const awaitingTerminal = ref(false)

  const fixSelected = async () => {
    const ids = [...selected.value]
    if (!ids.length) {
      return
    }
    selected.value = new Set()
    await issuesStore.queueIds(type(), ids)
    awaitingTerminal.value = true
    terminal.run('./fix', [`--${type()}`], 'fix')
  }

  const revertSelected = async (mode: 'undo' | 'undo-resolved') => {
    const ids = [...selectedResolved.value]
    if (!ids.length) {
      return
    }
    selectedResolved.value = new Set()
    await issuesStore.queueRevert(type(), ids, mode)
    awaitingTerminal.value = true
    terminal.run('./fix', ['--revert', `--${type()}`, `--mode=${mode}`], 'fix')
  }

  watch(
    () => terminal.exitCode,
    (code) => {
      if (code === 0 && !terminal.isRunning && awaitingTerminal.value) {
        awaitingTerminal.value = false
        issuesStore.fetchType(type(), true)
        issuesStore.fetchResolved(type(), true)
        issuesStore.fetchSummary()
      }
    },
    { immediate: true },
  )

  return { selected, selectedResolved, fixSelected, revertSelected }
}
