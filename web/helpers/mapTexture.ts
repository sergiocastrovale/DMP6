// The pure maths behind the world map's cover-art country fills.

export const TEXTURE_CELL_PX = 100

// A near-square grid for `count` covers: as many columns as the square root, enough rows for the rest.
export const textureGrid = (count: number): { cols: number, rows: number } => {
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
}

// Where the cover mosaic goes inside a country's bounding box: scaled to cover the box (like CSS `object-fit: cover`)
// and centred, so a wide mosaic in a tall country overflows on both sides equally instead of leaving a gap.
export const patternPlacement = (
  bbox: { width: number, height: number },
  texture: { cols: number, rows: number },
): { x: number, y: number, width: number, height: number } => {
  const textureRatio = texture.cols / texture.rows
  const boxRatio = bbox.width / bbox.height
  const [width, height] = textureRatio > boxRatio
    ? [bbox.height * textureRatio, bbox.height]
    : [bbox.width, bbox.width / textureRatio]
  return { x: (bbox.width - width) / 2, y: (bbox.height - height) / 2, width, height }
}

// The texture batches the generator processes at once: enough concurrency to keep the network busy without loading
// every cover of the world at the same moment.
export const TEXTURE_BATCH_SIZE = 5
