import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import InfiniteScroll from '../../components/InfiniteScroll.vue'

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(public callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeIntersectionObserver.instances.push(this)
  }
}

describe('InfiniteScroll.vue', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits load when the sentinel intersects', async () => {
    const wrapper = await mountSuspended(InfiniteScroll)
    FakeIntersectionObserver.instances[0]!.callback([{ isIntersecting: true }])
    expect(wrapper.emitted('load')).toHaveLength(1)
  })

  it('does not emit while the sentinel is out of range', async () => {
    const wrapper = await mountSuspended(InfiniteScroll)
    FakeIntersectionObserver.instances[0]!.callback([{ isIntersecting: false }])
    expect(wrapper.emitted('load')).toBeUndefined()
  })

  it('observes the sentinel again when recheck() is called, so a still-visible sentinel reports again', async () => {
    const wrapper = await mountSuspended(InfiniteScroll)
    const observer = FakeIntersectionObserver.instances[0]!
    const before = observer.observe.mock.calls.length
    ;(wrapper.vm as unknown as { recheck: () => void }).recheck()
    await nextTick()
    expect(observer.unobserve).toHaveBeenCalledTimes(1)
    expect(observer.observe.mock.calls.length).toBe(before + 1)
  })

  it('rechecks when rows are added beside the sentinel', async () => {
    const wrapper = await mountSuspended(InfiniteScroll)
    const observer = FakeIntersectionObserver.instances[0]!
    wrapper.element.parentElement!.appendChild(document.createElement('p'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(observer.unobserve).toHaveBeenCalled()
  })
})
