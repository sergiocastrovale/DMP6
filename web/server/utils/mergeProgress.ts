export type MergeStep = 'moving' | 'indexing' | 'syncing'

interface ProgressEntry {
  step: MergeStep
  title: string
  destPath?: string
}

const progress = new Map<string, ProgressEntry>()

export const setMergeProgress = (id: string, entry: ProgressEntry) => progress.set(id, entry)
export const clearMergeProgress = (id: string) => progress.delete(id)
export const getAllMergeProgress = (): Record<string, ProgressEntry> => Object.fromEntries(progress.entries())
