import { renderSubsonicXml, type XmlObject } from './xml'

// Reported API version, not DMP's own version - Subsonic clients gate features on this.
export const SUBSONIC_API_VERSION = '1.16.1'

export const OPEN_SUBSONIC_EXTENSIONS: XmlObject[] = [
  { name: 'apiKeyAuthentication', versions: [1] },
  { name: 'formPost', versions: [1] },
]

export type SubsonicFormat = 'xml' | 'json'

const okAttrs = (): XmlObject => ({
  status: 'ok',
  version: SUBSONIC_API_VERSION,
  type: 'dmp',
  serverVersion: SUBSONIC_API_VERSION,
  openSubsonic: true,
})

const failedAttrs = (): XmlObject => ({
  status: 'failed',
  version: SUBSONIC_API_VERSION,
  type: 'dmp',
  serverVersion: SUBSONIC_API_VERSION,
  openSubsonic: true,
})

export const subsonicOk = (format: SubsonicFormat, body: XmlObject = {}): string | XmlObject => {
  if (format === 'xml') {
    return renderSubsonicXml(okAttrs(), body)
  }
  return { 'subsonic-response': { ...okAttrs(), ...body } }
}

export const subsonicError = (format: SubsonicFormat, code: number, message: string): string | XmlObject => {
  const body: XmlObject = { error: { code, message } }
  if (format === 'xml') {
    return renderSubsonicXml(failedAttrs(), body)
  }
  return { 'subsonic-response': { ...failedAttrs(), ...body } }
}
