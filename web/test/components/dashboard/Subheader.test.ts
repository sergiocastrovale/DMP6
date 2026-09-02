import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Subheader from '../../../components/dashboard/Subheader.vue'
import { useAuth } from '../../../composables/useAuth'
import { useGlobalStore } from '../../../stores/global'

// The stat bar (Artists/Releases/Tracks/Genres/Total Plays/Playtime/Size) used to be its own
// components/layout/Statistics.vue, rendered only here - it's inlined now that this was its one
// caller. mountSuspended reuses one Nuxt app (and Pinia instance) per file, and mounting is what
// makes that instance active, so composables/stores are only touched after mount.
const mountSubheader = async () => {
  vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(null))
  const wrapper = await mountSuspended(Subheader)
  useAuth().user.value = {
    id: 1, username: 'admin', email: 'admin@test.local', role: 'ADMIN', permissions: [], mustChangePassword: false,
  }
  const store = useGlobalStore()
  store.loaded = true
  store.stats = {
    artists: 100, releases: 200, tracks: 3000, genres: 40, totalPlays: 5000, totalFileSize: 123456789,
  } as any
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('dashboard/Subheader.vue', () => {
  it('shows all seven stats', async () => {
    const wrapper = await mountSubheader()
    const labels = wrapper.findAll('.font-mono').map(el => el.text())
    expect(labels).toEqual(['Artists', 'Releases', 'Tracks', 'Genres', 'Total Plays', 'Playtime', 'Size'])
  })

  // Artists/Total Plays/Size are the ones dropped on phone width - seven stats plus separators don't
  // fit without wrapping. `hidden md:flex` keeps them in the DOM (no store/layout churn) but out of
  // the mobile layout.
  it('marks artists, total plays and size mobile-hidden, leaving releases/tracks/genres/playtime always visible', async () => {
    const wrapper = await mountSubheader()
    const stat = (label: string) => wrapper.findAll('.font-mono').find(el => el.text() === label)!.element.parentElement!

    for (const label of ['Artists', 'Total Plays', 'Size']) {
      expect(stat(label).className).toContain('hidden')
      expect(stat(label).className).toContain('md:flex')
    }
    for (const label of ['Releases', 'Tracks', 'Genres', 'Playtime']) {
      expect(stat(label).className).not.toContain('hidden')
    }
  })

  it('narrows the separator gaps on mobile, widening at md', async () => {
    const wrapper = await mountSubheader()
    const bar = wrapper.findAll('.flex.items-center').find(el => el.classes().includes('gap-3'))!
    expect(bar.classes()).toEqual(expect.arrayContaining(['gap-3', 'md:gap-5']))
  })

  // Artists (the first array item) is mobileHidden, so on mobile the leading visible stat is
  // Releases - its separator would otherwise render (a plain `i > 0` doesn't know Artists is hidden),
  // leaving a stray bar + gap at the start of the row. Every separator that follows a hidden stat, or
  // has no visible predecessor on mobile, must hide there too and only reappear at md (where nothing
  // is hidden).
  it('drops the separator in front of the first mobile-visible stat, and keeps every desktop separator', async () => {
    const wrapper = await mountSubheader()
    const separators = wrapper.findAll('.w-px.self-stretch')
    const labels = wrapper.findAll('.font-mono').map(el => el.text())
    const separatorClasses = (label: string) => {
      const el = wrapper.findAll('.font-mono').find(e => e.text() === label)!.element.parentElement!
      const sep = el.previousElementSibling as HTMLElement
      return sep.className
    }

    // Releases is first-visible-on-mobile: its leading separator must be mobile-hidden.
    expect(separatorClasses('Releases')).toContain('hidden')
    expect(separatorClasses('Releases')).toContain('md:block')
    // Tracks/Genres/Playtime each follow a visible predecessor on mobile: their separators show there.
    for (const label of ['Tracks', 'Genres', 'Playtime']) {
      expect(separatorClasses(label)).not.toContain('hidden')
    }
    // Every separator still exists (6 = one per stat after the first) so desktop keeps its full set.
    expect(separators).toHaveLength(labels.length - 1)
  })
})
