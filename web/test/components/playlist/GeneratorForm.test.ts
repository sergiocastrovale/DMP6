import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GeneratorForm from '../../../components/playlist/GeneratorForm.vue'

const { fetchMock, toast, pushMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  pushMock: vi.fn(),
}))

vi.stubGlobal('$fetch', fetchMock)

vi.mock('~/stores/toast', () => ({
  useToastStore: () => toast,
}))

mockNuxtImport('navigateTo', () => pushMock)

describe('playlist/GeneratorForm.vue', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    toast.success.mockClear()
    toast.error.mockClear()
    pushMock.mockClear()
  })
  afterEach(() => vi.clearAllMocks())

  it('defaults to a Genre generator with the genre terms label', async () => {
    const wrapper = await mountSuspended(GeneratorForm)
    expect(wrapper.text()).toContain('Genres')
    expect(wrapper.get('select').element.value).toBe('GENRE')
  })

  it('switches the terms label and hint when the type changes to Region', async () => {
    const wrapper = await mountSuspended(GeneratorForm)
    await wrapper.get('select').setValue('REGION')
    expect(wrapper.text()).toContain('Country codes')
    expect(wrapper.text()).toContain('ISO 3166-1')
  })

  it('blocks submit and shows an error on invalid input, without calling the API', async () => {
    const wrapper = await mountSuspended(GeneratorForm)
    await wrapper.get('input[id]').setValue('Rock')
    // Only an exclude line - no actual keyword to match on.
    await wrapper.findAll('textarea')[1]!.setValue('-indie rock')

    await wrapper.get('form').trigger('submit')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/keyword/i)
  })

  it('submits parsed terms and redirects on success (create)', async () => {
    fetchMock.mockResolvedValue({ success: true, generator: {} })
    const wrapper = await mountSuspended(GeneratorForm)

    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('Rock')
    const textareas = wrapper.findAll('textarea')
    await textareas[1]!.setValue('rock\ngrunge\n-indie rock')

    await wrapper.get('form').trigger('submit')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/playlist-generators', {
      method: 'POST',
      body: { type: 'GENRE', name: 'Rock', description: undefined, terms: ['rock', 'grunge', '-indie rock'] },
    })
    expect(pushMock).toHaveBeenCalledWith('/playlists/setup/generated')
  })

  it('loads the existing row in edit mode and fixes the type (no select)', async () => {
    fetchMock.mockResolvedValue({
      id: 'g1', type: 'REGION', name: 'Japan', slug: 'japan', description: null, terms: ['JP'], trackCount: 12, generatedAt: null,
    })
    const wrapper = await mountSuspended(GeneratorForm, { props: { id: 'g1' } })

    expect(fetchMock).toHaveBeenCalledWith('/api/playlist-generators/g1')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Region')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('Japan')
  })
})
