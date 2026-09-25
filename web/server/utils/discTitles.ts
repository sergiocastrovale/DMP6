// Disc subheader titles for a multi-disc release's tracklist ("Disc 1 — Deliverance"), keyed by MB
// medium position - the same number a box track's discNumber carries. MB's own medium title wins;
// failing that, the standalone release the disc reprints (MusicBrainzReleaseMedium.equivalentReleaseId,
// docs/sync_decisions.md §9). A title that merely repeats the release's own is noise (a deluxe edition's
// disc 1 reprinting the standard edition) and is dropped. Pure, no I/O.

export interface DiscMediumRow {
  position: number
  title: string | null
  equivalentReleaseId: string | null
}

export const buildDiscTitles = (
  releaseTitle: string,
  media: DiscMediumRow[],
  equivalentTitleById: Map<string, string>,
): Record<number, string> => {
  const own = releaseTitle.trim().toLowerCase()
  const titles: Record<number, string> = {}
  for (const m of media) {
    const title = (m.title?.trim() || (m.equivalentReleaseId ? equivalentTitleById.get(m.equivalentReleaseId)?.trim() : null)) ?? null
    if (title && title.toLowerCase() !== own) {
      titles[m.position] = title
    }
  }
  return titles
}
