import { randomBytes } from 'node:crypto'

// Canonical slug generator - the single source of truth so slug rules never drift between callers. Accents are
// folded ("Café" -> "cafe") before anything that is still not a-z/0-9 is dropped.
export const generateSlug = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// A playlist slug is only a route segment, so a name with nothing Latin in it (Japanese, Arabic, emoji) still gets a
// working one instead of being refused: `playlist-` plus six random hex characters.
export const playlistSlug = (name: string): string =>
  generateSlug(name) || `playlist-${randomBytes(3).toString('hex')}`
