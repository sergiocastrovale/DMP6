// Strip diacritics, bracketed qualifiers (FLAC), and punctuation; collapse to single spaces.
export const normalizeTitle = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
