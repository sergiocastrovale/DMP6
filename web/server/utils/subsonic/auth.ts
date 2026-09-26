import type { H3Event } from 'h3'
import { resolveApiKey } from '~/server/utils/apiKeys'
import { clientIp } from '~/server/utils/clientIp'
import { isLoginLocked, registerLoginFailure, clearLoginFailures } from '~/server/utils/loginThrottle'
import { SubsonicApiError, SubsonicErrorCode } from './errors'
import type { SubsonicParams } from './params'
import type { SessionUser } from '~/types/auth'

const throttleKeyFor = (event: H3Event): string => `subsonic:${clientIp(event)}`

// Every /rest/* request carries credentials (apiKey), unlike the cookie-session web app where auth
// happens once at login - so this reuses the same in-memory throttle as /api/auth/login rather than
// letting a script hammer resolveApiKey's DB lookup unthrottled. bcrypt-hashed passwords
// (server/utils/password.ts) can't support Subsonic's classic t=md5(password+salt) scheme, so
// u/p/t are refused outright rather than silently failing every check.
export const authenticateSubsonicRequest = async (event: H3Event, params: SubsonicParams): Promise<SessionUser> => {
  const apiKey = params.str('apiKey')
  const legacyUser = params.str('u')
  const legacyPassword = params.str('p')
  const legacyToken = params.str('t')

  if (apiKey && (legacyUser || legacyPassword || legacyToken)) {
    throw new SubsonicApiError(SubsonicErrorCode.MULTIPLE_CONFLICTING_AUTH, 'Provide either apiKey or username/password, not both')
  }

  if (!apiKey) {
    throw new SubsonicApiError(
      SubsonicErrorCode.PASSWORD_AUTH_NOT_SUPPORTED,
      'Username/password and token auth are not supported - generate an API key in Settings → Subsonic',
    )
  }

  const throttleKey = throttleKeyFor(event)
  if (isLoginLocked(throttleKey)) {
    throw new SubsonicApiError(SubsonicErrorCode.INVALID_API_KEY, 'Too many failed attempts - try again shortly')
  }

  const user = await resolveApiKey(apiKey)
  if (!user) {
    registerLoginFailure(throttleKey)
    throw new SubsonicApiError(SubsonicErrorCode.INVALID_API_KEY, 'Invalid API key')
  }
  clearLoginFailures(throttleKey)

  if (user.mustChangePassword) {
    throw new SubsonicApiError(SubsonicErrorCode.NOT_AUTHORIZED, 'Password change required - log in to the web app first')
  }

  return user
}
