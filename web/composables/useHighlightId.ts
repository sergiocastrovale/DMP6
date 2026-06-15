// Reads ?highlight=<id> from the URL so a queue row can be scrolled-to + flashed,
// then clears it after a few seconds. Shared by the per-tab download pages.
export const useHighlightId = () => {
  const route = useRoute()
  const highlightId = ref<string | null>((route.query.highlight as string) || null)

  if (highlightId.value) {
    setTimeout(() => { highlightId.value = null }, 4000)
  }

  return highlightId
}
