import { describe, expect, it } from 'vitest'
import {
  MONITORING_FIELDS, buildDownloadSettingsBody, fromChoice, numberInput, toNull, triState,
  type DownloadSettingsFormState,
} from '../../helpers/downloadSettingsForm'

describe('tri-state', () => {
  it('maps null/undefined to default and back', () => {
    expect(triState(null)).toBe('default')
    expect(triState(undefined)).toBe('default')
    expect(triState(true)).toBe('on')
    expect(triState(false)).toBe('off')
    expect(fromChoice('default')).toBeNull()
    expect(fromChoice('on')).toBe(true)
    expect(fromChoice('off')).toBe(false)
  })
})

describe('number inputs', () => {
  it('blank is null (env default), anything else a number - including 0', () => {
    expect(toNull('')).toBeNull()
    expect(toNull('12')).toBe(12)
    expect(toNull('0')).toBe(0)
    expect(numberInput(null)).toBe('')
    expect(numberInput(undefined)).toBe('')
    expect(numberInput(7)).toBe('7')
    expect(numberInput(0)).toBe('0')
  })
})

describe('MONITORING_FIELDS', () => {
  it('covers the eight knobs once each, each with a default hint and its env name', () => {
    expect(MONITORING_FIELDS.map(f => f.key)).toEqual([
      'maxConcurrentDownloads', 'searchPicksPerInterval', 'searchIntervalSec', 'gapsPicksPerRun',
      'gapsIntervalMin', 'retryCooldownDays', 'noProgressSec', 'maxDownloadAttempts',
    ])
    for (const f of MONITORING_FIELDS) {
      expect(f.description).toMatch(/Default \d+\. \([A-Z_]+\)$/)
      expect(f.description).toContain(`Default ${f.placeholder}.`)
    }
  })
})

describe('buildDownloadSettingsBody', () => {
  const state = (over: Partial<DownloadSettingsFormState> = {}): DownloadSettingsFormState => ({
    form: { slskdUrl: 'http://s', slskdApiKey: '', downloadsPath: '', downloadDirTemplate: '', downloadFormats: 'flac', downloadMinBitrate: '320' },
    monitoring: {
      maxConcurrentDownloads: '4', searchPicksPerInterval: '', searchIntervalSec: '', gapsPicksPerRun: '', gapsIntervalMin: '',
      retryCooldownDays: '0', noProgressSec: '', maxDownloadAttempts: '',
    },
    choices: { downloadsEnabled: 'default', flacToMp3: 'on', monitorEnabled: 'off', songkongEnabled: 'default', autoMergeDownloads: 'default' },
    flacToMp3Bitrate: '256',
    ...over,
  })

  it('sends blanks as null, keeps the API key out when blank, and maps choices', () => {
    const body = buildDownloadSettingsBody(state())
    expect(body).toMatchObject({
      slskdUrl: 'http://s', slskdApiKey: undefined, downloadsPath: null, downloadDirTemplate: null, downloadFormats: 'flac',
      downloadMinBitrate: 320, downloadsEnabled: null, flacToMp3: true, flacToMp3Bitrate: 256, monitorEnabled: false,
      songkongEnabled: null, autoMergeDownloads: null,
      maxConcurrentDownloads: 4, searchPicksPerInterval: null, retryCooldownDays: 0,
    })
  })

  it('includes a typed API key', () => {
    const s = state()
    s.form.slskdApiKey = 'secret'
    expect(buildDownloadSettingsBody(s).slskdApiKey).toBe('secret')
  })
})
