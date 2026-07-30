import { describe, expect, it } from 'vitest'
import { isQbitComplete, isQbitErrored, type QbitTorrentInfo } from '../../../server/utils/qbittorrent'

const info = (overrides: Partial<QbitTorrentInfo> = {}): QbitTorrentInfo => ({
  hash: 'h', name: 'n', state: 'downloading', progress: 0, size: 100, completed: 0, downloaded: 0, tags: '',
  ...overrides,
})

describe('isQbitComplete', () => {
  it('is true for known done states', () => {
    for (const state of ['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP', 'checkingUP']) {
      expect(isQbitComplete(info({ state }))).toBe(true)
    }
  })

  it('is true when progress reaches 1 regardless of state', () => {
    expect(isQbitComplete(info({ state: 'downloading', progress: 1 }))).toBe(true)
  })

  it('is false for an in-progress download below 100%', () => {
    expect(isQbitComplete(info({ state: 'downloading', progress: 0.5 }))).toBe(false)
  })
})

describe('isQbitErrored', () => {
  it('recognizes error and missingFiles states', () => {
    expect(isQbitErrored(info({ state: 'error' }))).toBe(true)
    expect(isQbitErrored(info({ state: 'missingFiles' }))).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isQbitErrored(info({ state: 'downloading' }))).toBe(false)
  })
})
