// The sizing rules of the artist-network force graph, kept out of the d3 wiring so they can be tested.

export interface GraphMetrics {
  maxShared: number
  maxTracks: number
}

// The largest link weight and node size in the graph: every visual scale is relative to these.
export const graphMetrics = (
  nodes: { trackCount: number }[],
  links: { sharedTracks: number }[],
): GraphMetrics => ({
  maxShared: Math.max(...links.map(l => l.sharedTracks), 1),
  maxTracks: Math.max(...nodes.map(n => n.trackCount), 1),
})

// The focused artist is drawn larger than the rest.
export const FOCUS_RADIUS_FACTOR = 1.4

// A focused view (one artist's collaborators) spaces its nodes further apart than the whole-library view.
export const linkDistance = (sharedTracks: number, hasFocus: boolean): number =>
  (hasFocus ? 140 : 100) / Math.sqrt(sharedTracks)

export const linkStrength = (sharedTracks: number, maxShared: number): number =>
  Math.min(0.8, sharedTracks / maxShared)

export const chargeStrength = (hasFocus: boolean): number => (hasFocus ? -250 : -150)

export const centerStrength = (hasFocus: boolean): number => (hasFocus ? 0.02 : 0.05)

// A label's font size follows its node's radius, within 7-10px, and the focus label is fixed and bold.
export const labelFontSize = (radius: number, isFocus: boolean): number =>
  isFocus ? 12 : Math.max(7, Math.min(10, radius * 0.7))
