import type { ChildProcess } from 'child_process'

let runningProcess: ChildProcess | null = null

export const getMosaicProcess = (): ChildProcess | null => runningProcess

export const setMosaicProcess = (proc: ChildProcess | null) => {
  runningProcess = proc
}
