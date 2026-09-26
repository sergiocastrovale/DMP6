import { SCRIPT_OOM_SCORE_ADJ } from '~/helpers/constants'

// The scripts share the web container's memory limit (see SCRIPT_OOM_SCORE_ADJ). Both forms below lower the priority of
// what they start, by raising its own oom_score_adj, which every child inherits. Best effort: where /proc is not
// writable (not Linux, a locked-down container) the command just runs unchanged.

// A shell line for a script that is about to start the command itself (the terminal's tmux wrapper).
export const OOM_SHIELD_SHELL = `{ echo ${SCRIPT_OOM_SCORE_ADJ} > /proc/self/oom_score_adj; } 2>/dev/null || true`

// The same for a process spawned directly: `spawn(...oomShielded(binary, args))`. `exec` keeps the pid, so kill signals
// reach the command itself.
export const oomShielded = (command: string, args: string[] = []): [string, string[]] => [
  'bash',
  ['-c', `${OOM_SHIELD_SHELL}; exec "$0" "$@"`, command, ...args],
]
