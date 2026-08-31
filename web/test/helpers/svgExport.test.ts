import { describe, expect, it } from 'vitest'
import { exportFilename, standaloneSvgMarkup } from '../../helpers/svgExport'

describe('standaloneSvgMarkup', () => {
  it('replaces the live root element so the export is sized to what was on screen', () => {
    // A live Leaflet SVG has no width/height of its own and carries a pan/zoom transform, so
    // serializing it verbatim rasterizes to an empty or clipped image.
    const live = '<svg class="leaflet-zoom-animated" style="transform: translate3d(1px,2px,0)"><g><path d="M0 0"/></g></svg>'
    const out = standaloneSvgMarkup(live, 800, 600, '#0e0d0c')
    expect(out).toContain('width="800"')
    expect(out).toContain('height="600"')
    expect(out).toContain('viewBox="0 0 800 600"')
    expect(out).toContain('<path d="M0 0"/>')
    expect(out).not.toContain('leaflet-zoom-animated')
  })

  it('paints an opaque background under the content', () => {
    // An SVG with no background rasterizes transparent, which reads as a black box in most viewers.
    const out = standaloneSvgMarkup('<svg><g/></svg>', 10, 10, '#123456')
    expect(out).toContain('<rect width="10" height="10" fill="#123456"/>')
  })

  it('declares both namespaces so xlink:href pattern fills survive', () => {
    const out = standaloneSvgMarkup('<svg><g/></svg>', 10, 10, '#000')
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
  })

  it('keeps inner content that itself contains the string "</svg>" only at the very end', () => {
    const out = standaloneSvgMarkup('<svg><desc>a &lt;/svg&gt; b</desc></svg>', 4, 4, '#000')
    expect(out).toContain('<desc>a &lt;/svg&gt; b</desc>')
    expect(out.endsWith('</svg>')).toBe(true)
  })
})

describe('exportFilename', () => {
  it('stamps the day so downloads do not collide in a folder', () => {
    expect(exportFilename('dmp-world-map', new Date(2026, 7, 31))).toBe('dmp-world-map-2026-08-31.png')
  })

  it('zero-pads month and day', () => {
    expect(exportFilename('x', new Date(2026, 0, 5))).toBe('x-2026-01-05.png')
  })
})
