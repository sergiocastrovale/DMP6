// How an artist is told apart from others with the same name: MusicBrainz's own comment and its country, e.g.
// "Portuguese band · Portugal". Display only - the URL carries the id (scripts/common/src/homonyms.rs).

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })
  : null

export const regionName = (code: string | null | undefined): string | null => {
  if (!code) {
    return null
  }
  try {
    return regionNames?.of(code.toUpperCase()) ?? code
  }
  catch {
    return code
  }
}

export interface HomonymNoteSource {
  country?: string | null
  disambiguation?: string | null
}

// "Portuguese band · Portugal", "Portugal", "Korean illustrator", or null when there is nothing to tell them apart by.
export const homonymNote = (artist: HomonymNoteSource): string | null => {
  const parts = [artist.disambiguation?.trim() || null, regionName(artist.country)].filter((p): p is string => !!p)
  // "Portuguese band · Portugal" repeats itself less than it looks, but "Portugal · Portugal" would.
  const unique = parts.filter((p, i) => parts.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i)
  return unique.length ? unique.join(' · ') : null
}
