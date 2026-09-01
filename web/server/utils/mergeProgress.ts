import type { MergeProgressEntry } from '~/types/download'

const progress = new Map<string, MergeProgressEntry>()

export const setMergeProgress = (id: string, entry: MergeProgressEntry) => progress.set(id, entry)
export const clearMergeProgress = (id: string) => progress.delete(id)
export const getAllMergeProgress = (): Record<string, MergeProgressEntry> => Object.fromEntries(progress.entries())
