import type { PlaylistGeneratorType } from '~/types/playlistGenerator'

// Textarea → term lines: trim, drop blanks, dedupe case-insensitively (first occurrence wins so a
// user's own casing/exclude-prefix is kept). Shared by the form (parse on submit) and the API
// (re-parse defensively - a client bypassing the form must not write raw garbage).
export const parseTerms = (text: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const term = raw.trim()
    if (!term) { continue }
    const key = term.toLowerCase()
    if (seen.has(key)) { continue }
    seen.add(key)
    out.push(term)
  }
  return out
}

export const termsToText = (terms: string[]): string => terms.join('\n')

const COUNTRY_CODE_RE = /^[a-zA-Z]{2}$/

export const validateGenerator = (input: { type: PlaylistGeneratorType, name: string, terms: string[] }): string | null => {
  if (!input.name.trim()) {
    return 'Name is required'
  }
  if (!/[a-z0-9]/i.test(input.name)) {
    return 'Name must contain at least one letter or number'
  }

  if (input.type === 'GENRE') {
    const hasKeyword = input.terms.some(t => !t.startsWith('-'))
    return hasKeyword ? null : 'At least one genre keyword is required (lines starting with "-" only exclude)'
  }

  if (input.type === 'REGION') {
    if (input.terms.length === 0) {
      return 'At least one country code is required'
    }
    const bad = input.terms.find(t => !COUNTRY_CODE_RE.test(t))
    return bad ? `"${bad}" is not a valid 2-letter country code` : null
  }

  return 'Invalid generator type'
}

export const GENERATOR_TERMS_LABEL: Record<PlaylistGeneratorType, string> = {
  GENRE: 'Genres',
  REGION: 'Country codes',
}

export const GENERATOR_TERMS_PLACEHOLDER: Record<PlaylistGeneratorType, string> = {
  GENRE: 'rock\ngrunge\nbritpop\n-indie rock',
  REGION: 'JP\nKR\nCN',
}

export const GENERATOR_TERMS_HINT: Record<PlaylistGeneratorType, string> = {
  GENRE: 'One genre keyword per line. A DB genre matches if it equals a line exactly, or contains it as a whole word ("rock" also catches "hard rock"). A line starting with "-" excludes an exact genre name instead (e.g. "-indie rock").',
  REGION: 'One ISO 3166-1 alpha-2 country code per line (e.g. "JP", "GB"), matched against each artist\'s country.',
}
