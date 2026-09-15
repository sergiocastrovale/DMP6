import { createHash } from 'node:crypto'
import { GENIUS_FACT_MAX_CHARS } from '~/helpers/constants'
import { normalizeTitle } from '~/server/utils/releaseTitle'

// Pure text-shaping helpers around the Genius API - no I/O, unit-testable in isolation from the
// network client (server/utils/genius.ts).

// Genius returns a literal "?" (or blank) for artists/albums/songs with no written description.
const isEmptyDescription = (plain: string | null | undefined): boolean => {
  if (!plain) {return true}
  const trimmed = plain.trim()
  return trimmed === '' || trimmed === '?'
}

// Splits Genius' plain-text description into standalone fact-sized chunks: paragraph boundaries
// first, then sentence boundaries within an over-long paragraph, regrouped up to
// GENIUS_FACT_MAX_CHARS without ever cutting a sentence in half. Fragments too short to read as a
// standalone fact (headings, "[Verse]"-style leftovers) are dropped.
export const extractFacts = (plain: string | null | undefined): string[] => {
  if (isEmptyDescription(plain)) {return []}

  const paragraphs = plain!.split(/\n{2,}/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const facts: string[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length <= GENIUS_FACT_MAX_CHARS) {
      facts.push(paragraph)
      continue
    }
    const sentences = paragraph.match(/[^.!?]+[.!?]+(\s+|$)/g) ?? [paragraph]
    let chunk = ''
    for (const sentence of sentences) {
      const candidate = chunk ? `${chunk} ${sentence.trim()}` : sentence.trim()
      if (candidate.length > GENIUS_FACT_MAX_CHARS && chunk) {
        facts.push(chunk)
        chunk = sentence.trim()
      }
      else {
        chunk = candidate
      }
    }
    if (chunk) {facts.push(chunk)}
  }

  return facts.filter(f => f.length >= 40)
}

// Reuses releaseTitle.ts's normalizeTitle (strips diacritics/bracketed qualifiers/punctuation) so
// "Paranoid Android (Remastered)" matches "Paranoid Android" the same way release matching already does.
export const sameName = (a: string, b: string): boolean => normalizeTitle(a) === normalizeTitle(b)

export interface GeniusSearchHit {
  type: string
  result: {
    id: number
    title: string
    primary_artist: { id: number, name: string }
  }
}

// Genius' /search endpoint returns songs only (translations, live versions, other artists' covers
// mixed in) - pick the first hit that is actually this song by this artist.
export const pickSongHit = (hits: GeniusSearchHit[], title: string, artistName: string): GeniusSearchHit['result'] | null => {
  const hit = hits.find(h =>
    h.type === 'song'
    && sameName(h.result.primary_artist.name, artistName)
    && sameName(h.result.title, title),
  )
  return hit?.result ?? null
}

export const factHash = (text: string): string =>
  createHash('sha1').update(normalizeTitle(text)).digest('hex')

export type FactSubject = 'artist' | 'release' | 'track'

// Random subject each call so an artist accrues a mix of the three kinds over repeat visits.
export const pickSubject = (): FactSubject => {
  const subjects: FactSubject[] = ['artist', 'release', 'track']
  return subjects[Math.floor(Math.random() * subjects.length)]!
}
