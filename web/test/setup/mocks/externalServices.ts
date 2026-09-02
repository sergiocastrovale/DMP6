import { vi } from 'vitest'

// Canned responses for the external services the downloads pipeline talks to. Import the relevant
// factory in a test and pass it to `vi.mock('../../../server/utils/slskd', () => makeSlskdMock())`
// (adjust the relative path to the module under test).

export const makeSlskdMock = (overrides: Record<string, unknown> = {}) => ({
  isAudioFile: (name: string) => /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(name),
  isSlskdTerminal: (state: string) => /Completed|Errored|Cancelled|TimedOut|Rejected/.test(state),
  isSlskdFailed: (state: string) => /Completed|Errored|Cancelled|TimedOut|Rejected/.test(state) && !state.includes('Succeeded'),
  stripSlskdSuffix: (name: string) => name.replace(/_\d{6,}(?=\.[^.]+$)/, ''),
  searchSlskd: vi.fn().mockResolvedValue([]),
  enqueueSlskdDownload: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
})

export const makeLastfmMock = (overrides: Record<string, unknown> = {}) => ({
  isLastfmConfigured: () => true,
  scrobble: vi.fn().mockResolvedValue({ ok: true }),
  updateNowPlaying: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
})
