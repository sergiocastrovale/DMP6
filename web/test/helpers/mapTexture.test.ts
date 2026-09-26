import { describe, expect, it } from 'vitest'
import { patternPlacement, textureGrid } from '../../helpers/mapTexture'

describe('textureGrid', () => {
  it('makes a near-square grid with room for every cover', () => {
    expect(textureGrid(1)).toEqual({ cols: 1, rows: 1 })
    expect(textureGrid(4)).toEqual({ cols: 2, rows: 2 })
    expect(textureGrid(10)).toEqual({ cols: 4, rows: 3 })
    for (const n of [1, 2, 3, 7, 25, 150]) {
      const { cols, rows } = textureGrid(n)
      expect(cols * rows).toBeGreaterThanOrEqual(n)
    }
  })
})

describe('patternPlacement', () => {
  it('a wide mosaic in a tall box fills the height and overflows the sides equally', () => {
    const p = patternPlacement({ width: 100, height: 200 }, { cols: 4, rows: 2 })
    expect(p.height).toBe(200)
    expect(p.width).toBe(400)
    expect(p.x).toBe(-150)
    expect(p.y).toBe(0)
  })

  it('a tall mosaic in a wide box fills the width and overflows top and bottom equally', () => {
    const p = patternPlacement({ width: 200, height: 100 }, { cols: 1, rows: 2 })
    expect(p.width).toBe(200)
    expect(p.height).toBe(400)
    expect(p.y).toBe(-150)
    expect(p.x).toBe(0)
  })

  it('an exactly matching ratio fits without offset', () => {
    expect(patternPlacement({ width: 300, height: 300 }, { cols: 3, rows: 3 })).toEqual({ x: 0, y: 0, width: 300, height: 300 })
  })
})
