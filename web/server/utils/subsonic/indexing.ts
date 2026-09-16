// getArtists' A-Z index grouping. Pure/unit-testable - no DB, no h3.
export const IGNORED_ARTICLES = 'The El La Los Las Le Les'
const ARTICLE_LIST = IGNORED_ARTICLES.split(' ')

export const indexLetterFor = (name: string): string => {
  let n = name.trim()
  for (const article of ARTICLE_LIST) {
    if (n.toLowerCase().startsWith(`${article.toLowerCase()} `)) {
      n = n.slice(article.length + 1)
      break
    }
  }
  const ch = n.charAt(0).toUpperCase()
  return /[A-Z]/.test(ch) ? ch : '#'
}

export const groupByIndexLetter = <T extends { name: string }>(items: T[]): [string, T[]][] => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const letter = indexLetterFor(item.name)
    if (!groups.has(letter)) {groups.set(letter, [])}
    groups.get(letter)!.push(item)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}
