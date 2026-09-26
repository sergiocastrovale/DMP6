// Where a terminal run keeps its files. One place, so run/reconnect/stop/sessions can't disagree about it.
// Per session name: the tee'd output log (also the SSE source and the DMP_EXIT sentinel carrier), the wrapper
// script tmux executes, and the command metadata `stop` gates on (server/utils/terminalAccess.ts).
export const terminalLogPath = (session: string): string => `/tmp/dmp-${session}.log`
export const terminalScriptPath = (session: string): string => `/tmp/dmp-${session}.sh`
