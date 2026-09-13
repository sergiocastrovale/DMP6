// A PlaylistGenerator's `type` is deliberately narrower than PlaylistType (common.ts) - a
// generator seeds a GENRE or REGION playlist, never MANUAL.
export type PlaylistGeneratorType = 'GENRE' | 'REGION'

export interface PlaylistGeneratorRow {
  id: string
  type: PlaylistGeneratorType
  name: string
  slug: string
  description: string | null
  terms: string[]
  trackCount: number | null
  generatedAt: string | null
}

export interface PlaylistGeneratorInput {
  type: PlaylistGeneratorType
  name: string
  description?: string | null
  terms: string[]
}
