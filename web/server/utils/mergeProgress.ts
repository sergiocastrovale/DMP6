import type { MergeProgressEntry } from '~/types/download'
import { notifyDownloadsChanged } from '~/server/utils/downloadEvents'

const progress = new Map<string, MergeProgressEntry>()

// The batch is in memory, not in a row, so the download pages are told about it directly.
export const setMergeProgress = (id: string, entry: MergeProgressEntry) => {
  progress.set(id, entry)
  notifyDownloadsChanged()
}
export const clearMergeProgress = (id: string) => {
  progress.delete(id)
  notifyDownloadsChanged()
}
export const getAllMergeProgress = (): Record<string, MergeProgressEntry> => Object.fromEntries(progress.entries())
