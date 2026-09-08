import { describe, it, expect } from 'vitest'
import { acquireBlockReasons, mergeBlockReasons, environmentBlockReasons } from '~/server/utils/downloadEnvironment'
import type { DownloadEnvironment } from '~/types/download'

const ok = { ok: true, detail: null }
const healthy: DownloadEnvironment = {
  downloadsPath: ok,
  readyPath: ok,
  musicDir: ok,
  ffmpeg: ok,
  ffmpegRequired: true,
  slskd: ok,
}

describe('acquireBlockReasons', () => {
  it('empty when downloads path and slskd are both fine', () => {
    expect(acquireBlockReasons(healthy)).toEqual([])
  })

  it('reports an unmounted downloads path', () => {
    const env = { ...healthy, downloadsPath: { ok: false, detail: 'not mounted' } }
    expect(acquireBlockReasons(env)).toEqual(['not mounted'])
  })

  it('reports unreachable slskd, independent of merge-only checks', () => {
    const env = { ...healthy, slskd: { ok: false, detail: 'slskd down' }, musicDir: { ok: false, detail: 'no music dir' } }
    expect(acquireBlockReasons(env)).toEqual(['slskd down'])
  })
})

describe('mergeBlockReasons', () => {
  it('empty when ready path, music dir and ffmpeg (when required) are fine', () => {
    expect(mergeBlockReasons(healthy)).toEqual([])
  })

  it('reports a missing music dir', () => {
    const env = { ...healthy, musicDir: { ok: false, detail: 'MUSIC_DIR not configured' } }
    expect(mergeBlockReasons(env)).toEqual(['MUSIC_DIR not configured'])
  })

  it('ignores missing ffmpeg when flacToMp3 is off', () => {
    const env = { ...healthy, ffmpeg: { ok: false, detail: 'ffmpeg not found on PATH' }, ffmpegRequired: false }
    expect(mergeBlockReasons(env)).toEqual([])
  })

  it('blocks on missing ffmpeg when flacToMp3 is on', () => {
    const env = { ...healthy, ffmpeg: { ok: false, detail: 'ffmpeg not found on PATH' }, ffmpegRequired: true }
    expect(mergeBlockReasons(env)).toEqual(['ffmpeg not found on PATH'])
  })

  it('is independent of slskd — merging never depends on Soulseek', () => {
    const env = { ...healthy, slskd: { ok: false, detail: 'slskd down' } }
    expect(mergeBlockReasons(env)).toEqual([])
  })
})

describe('environmentBlockReasons', () => {
  it('empty when everything is healthy', () => {
    expect(environmentBlockReasons(healthy)).toEqual([])
  })

  it('unions acquire and merge reasons', () => {
    const env = {
      ...healthy,
      downloadsPath: { ok: false, detail: 'downloads path missing' },
      musicDir: { ok: false, detail: 'music dir missing' },
    }
    expect(environmentBlockReasons(env)).toEqual(['downloads path missing', 'music dir missing'])
  })

  it('dedupes a reason shared by both (e.g. downloadsPath feeds both readyPath-adjacent failures)', () => {
    const env = { ...healthy, downloadsPath: { ok: false, detail: 'same reason' }, slskd: { ok: false, detail: 'same reason' } }
    expect(environmentBlockReasons(env)).toEqual(['same reason'])
  })
})
