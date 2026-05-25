
interface GenomeNode {
  id: string
  name: string
  artistCount: number
}

interface GenomeLink {
  source: string
  target: string
  weight: number
}

export interface GenomeGraph {
  nodes: GenomeNode[]
  links: GenomeLink[]
}

export default defineEventHandler(async (): Promise<GenomeGraph> => {
  const genres = await prisma.genre.findMany({
    select: {
      id: true,
      name: true,
      artists: { select: { id: true } },
    },
  })

  const active = genres.filter((g) => g.artists.length > 0)
  const nodes: GenomeNode[] = active.map((g) => ({
    id: g.id,
    name: g.name,
    artistCount: g.artists.length,
  }))

  const genreArtistSets = new Map<string, Set<string>>()
  for (const genre of genres) {
    if (genre.artists.length > 0) {
      genreArtistSets.set(genre.id, new Set(genre.artists.map((a) => a.id)))
    }
  }

  const links: GenomeLink[] = []
  const nodeIds = nodes.map((n) => n.id)

  for (let i = 0; i < nodeIds.length; i++) {
    const setA = genreArtistSets.get(nodeIds[i]!)!
    for (let j = i + 1; j < nodeIds.length; j++) {
      const setB = genreArtistSets.get(nodeIds[j]!)!
      let shared = 0
      for (const id of setA) {
        if (setB.has(id)) {
          shared++
        }
      }
      if (shared > 0) {
        links.push({
          source: nodeIds[i]!,
          target: nodeIds[j]!,
          weight: shared,
        })
      }
    }
  }

  return { nodes, links }
})
