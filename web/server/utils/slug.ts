// Canonical slug generator - the single source of truth so slug rules never drift between callers
// (playlists/index.post.ts previously had its own inline copy - see audit #79).
export const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
