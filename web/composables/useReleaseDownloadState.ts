import { toValue, type MaybeRefOrGetter } from 'vue'
import type { UnifiedRelease } from '~/types/release'
import { downloadSubpage } from '~/helpers/functions'

export const useReleaseDownloadState = (release: MaybeRefOrGetter<UnifiedRelease>) => {
  const isDownloading = computed(() => toValue(release).downloadState === 'DOWNLOADING')
  const isEnriching = computed(() => toValue(release).downloadState === 'ENRICHING')
  const isAwaitingMerge = computed(() => toValue(release).downloadState === 'READY')
  const downloadFailed = computed(() => toValue(release).downloadState === 'FAILED')
  const isAbandoned = computed(() => toValue(release).downloadState === 'ABANDONED')

  const verifyDownload = () => {
    const r = toValue(release)
    return navigateTo(`${downloadSubpage(r.downloadState)}?highlight=${r.downloadedReleaseId}`)
  }

  return { isDownloading, isEnriching, isAwaitingMerge, downloadFailed, isAbandoned, verifyDownload }
}
