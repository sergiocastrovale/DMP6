import { createHash } from 'node:crypto'
import type { Settings } from '@prisma/client'

const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/'

export type LastfmSettings = Pick<Settings, 'lastfmApiKey' | 'lastfmSecret' | 'lastfmSessionKey' | 'lastfmUsername'>

export const isLastfmConfigured = (s: LastfmSettings): boolean => {
  return !!(s.lastfmApiKey && s.lastfmSecret && s.lastfmSessionKey)
}

export const signRequest = (params: Record<string, string>, secret: string): string => {
  const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('')
  return createHash('md5').update(sorted + secret, 'utf8').digest('hex')
}

export const callLastFm = async (
  method: string,
  params: Record<string, string>,
  settings: LastfmSettings,
): Promise<Record<string, unknown> | null> => {
  if (!isLastfmConfigured(settings)) return null

  const fullParams: Record<string, string> = {
    ...params,
    method,
    api_key: settings.lastfmApiKey!,
    sk: settings.lastfmSessionKey!,
  }
  fullParams.api_sig = signRequest(fullParams, settings.lastfmSecret!)
  fullParams.format = 'json'

  try {
    const res = await fetch(LASTFM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fullParams).toString(),
    })
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export const getAuthUrl = (apiKey: string, callbackUrl: string): string => {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callbackUrl)}`
}

export const getLastfmSession = async (
  token: string,
  apiKey: string,
  secret: string,
): Promise<{ sessionKey: string; username: string } | null> => {
  const params: Record<string, string> = {
    method: 'auth.getSession',
    api_key: apiKey,
    token,
  }
  params.api_sig = signRequest(params, secret)
  params.format = 'json'

  try {
    const res = await fetch(LASTFM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    const data = (await res.json()) as Record<string, any>
    if (data.session?.key && data.session?.name) {
      return { sessionKey: data.session.key, username: data.session.name }
    }
    return null
  } catch {
    return null
  }
}
