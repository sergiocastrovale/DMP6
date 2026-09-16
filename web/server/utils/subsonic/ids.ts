// getCoverArt is the one /rest/* endpoint shared across entity types, so its `id` param needs a
// prefix to say which table to resolve against - every other endpoint's `id` is unambiguous from
// context (getAlbum's id is always a LocalRelease id, etc.) and stays a bare cuid.
export const artistCoverArt = (id: string): string => `ar-${id}`
export const albumCoverArt = (id: string): string => `al-${id}`
export const playlistCoverArt = (id: string): string => `pl-${id}`

export type CoverArtRef = { type: 'artist' | 'album' | 'playlist', id: string } | null

export const parseCoverArtId = (raw: string): CoverArtRef => {
  if (raw.startsWith('ar-')) {return { type: 'artist', id: raw.slice(3) }}
  if (raw.startsWith('al-')) {return { type: 'album', id: raw.slice(3) }}
  if (raw.startsWith('pl-')) {return { type: 'playlist', id: raw.slice(3) }}
  return null
}
