// Reads a design token's live value off the document root. theme.css emits every colour as a
// real CSS custom property (`@theme static`) specifically so non-Tailwind rendering surfaces -
// Chart.js canvases, d3 SVGs, Leaflet tiles - can read the current theme instead of hard-coding
// a colour literal that silently drifts from the token the rest of the app uses.
export const cssVar = (name: string): string => {
  if (typeof document === 'undefined') {
    return ''
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
