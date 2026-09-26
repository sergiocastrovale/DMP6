import { randomBytes, timingSafeEqual } from 'node:crypto'

// CSRF protection for the Last.fm connect flow. Completing the callback overwrites the site's single scrobble
// session, so an attacker who could get an admin to open `/api/scrobble/callback?token=<attacker's token>`
// (a top-level GET, so SameSite=Lax still sends the admin's session cookie) would silently bind the server to
// the attacker's Last.fm account. The nonce closes that: connect.get.ts mints one, stores it in an httpOnly
// cookie in the initiating browser AND embeds it in the callback URL it hands to Last.fm; the callback only
// proceeds when both match. An attacker can forge neither.
export const OAUTH_STATE_COOKIE = 'dmp_lastfm_state'
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

export const createOAuthState = (): string => randomBytes(24).toString('base64url')

export const oauthStatesMatch = (fromUrl: string | undefined, fromCookie: string | undefined): boolean => {
  if (!fromUrl || !fromCookie) {
    return false
  }
  const a = Buffer.from(fromUrl)
  const b = Buffer.from(fromCookie)
  return a.length === b.length && timingSafeEqual(a, b)
}
