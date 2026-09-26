import type { UnifiedRelease } from '~/types/release'
import { findBundleParentRelease, releaseTitleSlug } from '~/helpers/artistPageLogic'

// Which release group / edition is open on the artist page, and moving to one: an "also part of" link in the info dialog,
// a bundle's parent, or a `?releaseId=` / `?release=` deep link.
export const useReleaseExpansion = (releases: () => UnifiedRelease[]) => {
  const route = useRoute()

  const expandedGroup = ref<string | null>(null)
  const expandedEdition = ref<string | null>(null)
  const selectedTrackId = ref<string | null>(null)

  const toggleGroup = (key: string) => {
    expandedGroup.value = expandedGroup.value === key ? null : key
    if (expandedGroup.value !== key) {
      expandedEdition.value = null
    }
  }

  const toggleEdition = (id: string) => {
    expandedEdition.value = expandedEdition.value === id ? null : id
  }

  const expandAndScrollTo = async (release: UnifiedRelease) => {
    const groupKey = release.releaseGroupId || `solo:${release.id}`
    expandedGroup.value = groupKey
    expandedEdition.value = release.id
    await nextTick()
    document.querySelector(`[data-group-key="${groupKey}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // An "also part of" link in the info dialog: the box's MusicBrainz release id, which is the card's own id for a box
  // that is a gap or a dissolved box, or its mbReleaseRowId for a box kept as one local release.
  const goToReleaseById = async (releaseId: string) => {
    const all = releases()
    const release = all.find(r => r.id === releaseId || r.localReleaseId === releaseId)
      ?? all.find(r => r.mbReleaseRowId === releaseId)
    if (release) {
      await expandAndScrollTo(release)
    }
  }

  const goToBundleParent = async (release: UnifiedRelease) => {
    const parent = findBundleParentRelease(releases(), release)
    if (parent) {
      await expandAndScrollTo(parent)
    }
  }

  const handleDeepLink = async () => {
    const targetSlug = route.query.release as string | undefined
    const targetId = route.query.releaseId as string | undefined
    if (!targetSlug && !targetId) {
      return
    }
    await nextTick()
    const all = releases()
    const release = targetId
      ? all.find(r => r.localReleaseId === targetId || r.id === targetId)
      : all.find(r => releaseTitleSlug(r.title) === targetSlug)
    if (!release) {
      return
    }
    selectedTrackId.value = (route.query.trackId as string) || null
    await expandAndScrollTo(release)
  }

  // onMounted (not an immediate watcher) for the initial run: handleDeepLink ends in document.querySelector, and an
  // immediate watcher's callback runs synchronously at the watch() call site - during Nuxt's server-side setup(), where
  // `document` doesn't exist. onMounted is client-only; the plain watch below only ever fires for a later, client-side
  // change to the releases (e.g. slower-arriving async data).
  onMounted(() => {
    if (releases().length) {
      handleDeepLink()
    }
  })

  watch(releases, () => {
    if (releases().length) {
      handleDeepLink()
    }
  })

  return { expandedGroup, expandedEdition, selectedTrackId, toggleGroup, toggleEdition, goToReleaseById, goToBundleParent }
}
