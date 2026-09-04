import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MobileSheet from '../../../components/player/MobileSheet.vue'
import { usePlayerStore } from '../../../stores/player'

// MobileSheet renders via <Teleport to="body">, so its content lives outside wrapper.element -
// query document.body directly, same pattern as MobileNav.test.ts's "More" sheet.
const byLabel = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const byTitle = (title: string) => document.body.querySelector<HTMLElement>(`[title^="${title}"]`)

const fetchMock = vi.fn().mockResolvedValue([])
vi.stubGlobal('$fetch', fetchMock)

const STUBS = {
  PlaylistAddDialog: true, ToggleFavorite: true, NuxtLink: true, ReleaseInfoDialog: true,
  VisualizerToggleButton: true,
}

let activePlayer: ReturnType<typeof usePlayerStore> | undefined
let activeWrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

const mountSheet = async () => {
  const wrapper = await mountSuspended(MobileSheet, { global: { stubs: STUBS } })
  activeWrapper = wrapper
  const player = usePlayerStore()
  activePlayer = player
  player.isVisible = true
  player.currentTrack = { id: 't1', title: 'Song', artist: 'Artist', album: 'A', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }
  await nextTick()
  return { wrapper, player }
}

describe('MobileSheet.vue', () => {
  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = undefined
    document.body.innerHTML = ''
    if (activePlayer) {
      activePlayer.currentTrack = null
      activePlayer.isVisible = false
      activePlayer.shuffleMode = 'off'
    }
  })

  it('renders transport, playlist, volume and favourite controls', async () => {
    await mountSheet()
    expect(byLabel('Previous track')).toBeTruthy()
    expect(byLabel('Next track')).toBeTruthy()
    expect(byLabel('Add to playlist')).toBeTruthy()
    expect(document.body.textContent).toContain('Song')
  })

  // The chevron/Escape close path goes isOpen=false -> <Transition> leave -> @after-leave ->
  // emit('close'). @vue/test-utils auto-stubs <Transition> (children toggle instantly, but the
  // stub never invokes hook props like onAfterLeave), so `emitted('close')` can't be observed
  // here - that full chain is covered by e2e/player-mobile.spec.ts in a real browser instead.
  // What IS verifiable at this level: the sheet's content disappears, and which of the two close
  // buttons does or doesn't reach for player.dismiss() - the actual regression this design guards
  // against (a naive reuse of PlayerClose on the chevron would pause playback and hide the whole
  // player, not just collapse the sheet).
  it('the chevron closes the sheet without calling player.dismiss()', async () => {
    const { player } = await mountSheet()
    const dismissSpy = vi.spyOn(player, 'dismiss').mockImplementation(() => {})
    byLabel('Collapse player')!.click()
    await nextTick()
    expect(document.querySelector('[data-testid="player-sheet"]')).toBeFalsy()
    expect(dismissSpy).not.toHaveBeenCalled()
  })

  it('the secondary-row close button does call player.dismiss()', async () => {
    const { player } = await mountSheet()
    const dismissSpy = vi.spyOn(player, 'dismiss').mockImplementation(() => {})
    byTitle('Dismiss player')!.click()
    await nextTick()
    expect(dismissSpy).toHaveBeenCalledOnce()
  })

  it('Escape closes the sheet', async () => {
    await mountSheet()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.querySelector('[data-testid="player-sheet"]')).toBeFalsy()
  })

  it('clicking the shuffle pill calls cycleShuffleMode', async () => {
    const { player } = await mountSheet()
    const spy = vi.spyOn(player, 'cycleShuffleMode').mockResolvedValue(undefined)
    byTitle('Shuffle')!.click()
    await nextTick()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('play/pause button reflects isPlaying and toggles playback on click', async () => {
    const { player } = await mountSheet()
    const spy = vi.spyOn(player, 'togglePlay').mockImplementation(() => {})
    const playBtn = byLabel('Play')
    expect(playBtn).toBeTruthy()
    playBtn!.click()
    await nextTick()
    expect(spy).toHaveBeenCalledOnce()
  })
})
