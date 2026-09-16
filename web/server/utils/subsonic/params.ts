import { SubsonicApiError, SubsonicErrorCode } from './errors'

// Typed reader over the merged query+form-body params a /rest/* request carries (built by
// server/routes/rest/[...path].ts's readRawParams). Kept pure/dependency-free so it's unit-testable
// without a real H3Event.
export interface SubsonicParams {
  str: (name: string) => string | undefined
  strRequired: (name: string) => string
  int: (name: string) => number | undefined
  bool: (name: string, def?: boolean) => boolean
  list: (name: string) => string[]
}

export const makeParams = (raw: Record<string, unknown>): SubsonicParams => {
  const values = (name: string): string[] => {
    const v = raw[name]
    if (v === undefined || v === null) {return []}
    return Array.isArray(v) ? v.map(String) : [String(v)]
  }

  return {
    str: name => values(name)[0],
    strRequired: (name) => {
      const v = values(name)[0]
      if (v === undefined || v === '') {
        throw new SubsonicApiError(SubsonicErrorCode.MISSING_PARAM, `Missing required parameter '${name}'`)
      }
      return v
    },
    int: (name) => {
      const v = values(name)[0]
      if (v === undefined) {return undefined}
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    },
    bool: (name, def = false) => {
      const v = values(name)[0]
      return v === undefined ? def : v === 'true' || v === '1'
    },
    list: name => values(name),
  }
}
