import { describe, expect, it } from 'vitest'
import { escapeLike, searchPatterns } from '~/server/utils/searchRank'

describe('server/utils/searchRank.escapeLike', () => {
  it('leaves plain text untouched', () => {
    expect(escapeLike('HIM')).toBe('HIM')
  })

  it('escapes %, _ and \\ so they match literally instead of as LIKE wildcards', () => {
    expect(escapeLike('100%_done')).toBe('100\\%\\_done')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('escapes the backslash first so it does not re-escape the characters it introduces', () => {
    // A naive char-by-char replace that escapes % and _ before \ would turn "a\\%b" into
    // "a\\\\%b" - the escaping backslash itself getting escaped a second time.
    expect(escapeLike('a\\%b')).toBe('a\\\\\\%b')
  })
})

describe('server/utils/searchRank.searchPatterns', () => {
  it('builds exact, prefix, word-boundary and substring patterns, all escaped', () => {
    expect(searchPatterns('love')).toEqual(['love', 'love%', '% love%', '%love%'])
    expect(searchPatterns('50%_off')).toEqual(['50\\%\\_off', '50\\%\\_off%', '% 50\\%\\_off%', '%50\\%\\_off%'])
  })
})
