export interface GridWindowInput {
  itemCount: number
  cols: number
  // Tile height plus the row gap: the distance from one row's top to the next.
  rowStride: number
  // How far the viewport's top edge is below the grid's top edge (negative while the grid is still below the fold).
  offsetIntoGrid: number
  viewportHeight: number
  overscanRows: number
}

export interface GridWindow {
  start: number
  end: number
  padTop: number
  padBottom: number
}

// Which slice of a uniform-row grid to render. Everything outside it is replaced by padding of the same height, so
// the scroll height (and the infinite-scroll sentinel beneath the grid) is exactly what it would be with every row
// in the DOM. `end` is exclusive.
export const computeGridWindow = ({ itemCount, cols, rowStride, offsetIntoGrid, viewportHeight, overscanRows }: GridWindowInput): GridWindow => {
  if (itemCount <= 0 || cols <= 0 || rowStride <= 0) {
    return { start: 0, end: Math.max(0, itemCount), padTop: 0, padBottom: 0 }
  }
  const totalRows = Math.ceil(itemCount / cols)
  const firstVisible = Math.floor(offsetIntoGrid / rowStride)
  const lastVisible = Math.ceil((offsetIntoGrid + viewportHeight) / rowStride)
  const startRow = Math.min(totalRows, Math.max(0, firstVisible - overscanRows))
  const endRow = Math.max(startRow, Math.min(totalRows, lastVisible + overscanRows))
  return {
    start: startRow * cols,
    end: Math.min(itemCount, endRow * cols),
    padTop: startRow * rowStride,
    padBottom: (totalRows - endRow) * rowStride,
  }
}

// The number of tracks in a resolved `grid-template-columns` value ("190px 190px 190px" -> 3).
export const columnCountFromTemplate = (template: string): number =>
  template.split(/\s+/).filter(track => track && track !== 'none').length
