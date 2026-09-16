// Subsonic/OpenSubsonic error codes (https://opensubsonic.netlify.app/docs/responses/error/).
// Every /rest/* response is HTTP 200 - failure is signalled inside the envelope, never via status
// code, so the dispatcher (server/routes/rest/[...path].ts) always maps thrown errors through here
// rather than letting Nitro's own error handling touch the response.
export const SubsonicErrorCode = {
  GENERIC: 0,
  MISSING_PARAM: 10,
  CLIENT_TOO_OLD: 20,
  SERVER_TOO_OLD: 30,
  BAD_CREDENTIALS: 40,
  TOKEN_AUTH_NOT_SUPPORTED: 41,
  // OpenSubsonic: username/password (or token) auth was used but this server only accepts apiKey.
  PASSWORD_AUTH_NOT_SUPPORTED: 42,
  // OpenSubsonic: both apiKey and u/p/t were supplied.
  MULTIPLE_CONFLICTING_AUTH: 43,
  // OpenSubsonic: apiKey was supplied but doesn't resolve to a live key.
  INVALID_API_KEY: 44,
  NOT_AUTHORIZED: 50,
  NOT_FOUND: 70,
} as const

export class SubsonicApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

interface H3LikeError {
  statusCode?: number
  statusMessage?: string
  message?: string
}

const STATUS_TO_CODE: Record<number, number> = {
  400: SubsonicErrorCode.MISSING_PARAM,
  401: SubsonicErrorCode.BAD_CREDENTIALS,
  403: SubsonicErrorCode.NOT_AUTHORIZED,
  404: SubsonicErrorCode.NOT_FOUND,
  409: SubsonicErrorCode.GENERIC,
}

// A SubsonicApiError carries its own code; anything else (an h3 createError, or an unexpected
// throw) is mapped by HTTP status - the same statusCode/statusMessage shape requirePermission,
// findOwnManualPlaylist etc. already throw everywhere else in the app.
export const mapErrorToSubsonic = (e: unknown): { code: number, message: string } => {
  if (e instanceof SubsonicApiError) {
    return { code: e.code, message: e.message }
  }
  const h3e = e as H3LikeError
  const code = (h3e.statusCode !== undefined ? STATUS_TO_CODE[h3e.statusCode] : undefined) ?? SubsonicErrorCode.GENERIC
  const message = h3e.statusMessage || h3e.message || 'Server error'
  return { code, message }
}
