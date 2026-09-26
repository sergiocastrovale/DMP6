import { computeGridWindow, columnCountFromTemplate } from '~/helpers/windowedGrid'
import { WINDOWED_GRID_MIN_ITEMS, WINDOWED_GRID_OVERSCAN_ROWS } from '~/helpers/constants'

const scrollParentOf = (el: HTMLElement): HTMLElement | null => {
  let node = el.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node
    }
    node = node.parentElement
  }
  return null
}

// Renders only the rows of a CSS grid that are near the viewport. The grid keeps its own column layout (auto-fill,
// responsive); the number of columns, the row stride and the scroll position are all read back from the browser, so
// nothing here duplicates the breakpoints. Rows must be uniform in height (the browse artist tiles are).
export const useWindowedGrid = (count: Ref<number>, grid: Ref<HTMLElement | null>) => {
  const start = ref(0)
  const end = ref(Number.POSITIVE_INFINITY)
  const padTop = ref(0)
  const padBottom = ref(0)
  const windowed = ref(false)

  let scroller: HTMLElement | null = null
  let resize: ResizeObserver | null = null
  let frame = 0

  const measure = () => {
    frame = 0
    const el = grid.value
    const tile = el?.firstElementChild as HTMLElement | null | undefined
    if (!el || !tile || count.value <= WINDOWED_GRID_MIN_ITEMS) {
      windowed.value = false
      return
    }
    const styles = getComputedStyle(el)
    const cols = columnCountFromTemplate(styles.gridTemplateColumns)
    const rowStride = tile.offsetHeight + (Number.parseFloat(styles.rowGap) || 0)
    if (cols < 1 || rowStride <= 0) {
      return
    }
    const gridTop = el.getBoundingClientRect().top
    const viewportTop = scroller ? scroller.getBoundingClientRect().top : 0
    const viewportHeight = scroller ? scroller.clientHeight : window.innerHeight
    const next = computeGridWindow({
      itemCount: count.value,
      cols,
      rowStride,
      offsetIntoGrid: viewportTop - gridTop,
      viewportHeight,
      overscanRows: WINDOWED_GRID_OVERSCAN_ROWS,
    })
    windowed.value = true
    start.value = next.start
    end.value = next.end
    padTop.value = next.padTop
    padBottom.value = next.padBottom
  }

  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(measure)
    }
  }

  const detach = () => {
    scroller?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    resize?.disconnect()
    scroller = null
  }

  watch(grid, (el) => {
    detach()
    if (!el) {
      return
    }
    scroller = scrollParentOf(el)
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    resize = new ResizeObserver(schedule)
    resize.observe(el)
    schedule()
  })

  watch(count, schedule)

  onBeforeUnmount(() => {
    detach()
    cancelAnimationFrame(frame)
  })

  return { windowed, start, end, padTop, padBottom }
}
