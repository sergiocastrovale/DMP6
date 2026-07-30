import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

// `ref` isn't available yet inside a vi.hoisted() factory (it runs before any imports, including
// vue itself), so the shared width ref is created lazily inside the vi.mock factory instead, which
// DOES run after `vue` has loaded (as a transitive dependency of @vueuse/core).
const state = vi.hoisted(() => ({ widthRef: null as unknown as { value: number } }))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const vue = await import('vue')
  state.widthRef = vue.ref(1024)
  return { ...actual, useWindowSize: () => ({ width: state.widthRef, height: vue.ref(768) }) }
})
mockNuxtImport('useState', () => {
  const stateMap = new Map<string, ReturnType<typeof ref>>()
  return (key: string, init: () => unknown) => {
    if (!stateMap.has(key)) stateMap.set(key, ref(init()))
    return stateMap.get(key)!
  }
})

import { useSidebar } from '../../composables/useSidebar'

describe('useSidebar', () => {
  it('collapses when width drops to or below 720', async () => {
    state.widthRef.value = 1024
    const { collapsed } = useSidebar()
    expect(collapsed.value).toBe(false)
    state.widthRef.value = 720
    await nextTick()
    expect(collapsed.value).toBe(true)
  })

  it('expands again above 720', async () => {
    state.widthRef.value = 500
    const { collapsed } = useSidebar()
    await nextTick()
    expect(collapsed.value).toBe(true)
    state.widthRef.value = 800
    await nextTick()
    expect(collapsed.value).toBe(false)
  })

  it('toggle flips the collapsed state', () => {
    state.widthRef.value = 1024
    const { collapsed, toggle } = useSidebar()
    expect(collapsed.value).toBe(false)
    toggle()
    expect(collapsed.value).toBe(true)
  })
})
