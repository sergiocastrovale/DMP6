import { describe, expect, it } from 'vitest'
import { webDatabaseUrl } from '../../../server/utils/databaseUrl'

describe('webDatabaseUrl', () => {
  it('is WEB_DATABASE_URL when set, so the web app can run as its own role', () => {
    expect(webDatabaseUrl({ WEB_DATABASE_URL: 'postgresql://dmp_web:pw@h:5432/dmp', DATABASE_URL: 'postgresql://dmp:pw@h:5432/dmp' }))
      .toBe('postgresql://dmp_web:pw@h:5432/dmp')
  })

  it('leaves the client on DATABASE_URL when it is unset or blank', () => {
    expect(webDatabaseUrl({ DATABASE_URL: 'postgresql://dmp:pw@h:5432/dmp' })).toBeUndefined()
    expect(webDatabaseUrl({ WEB_DATABASE_URL: '  ' })).toBeUndefined()
    expect(webDatabaseUrl({ WEB_DATABASE_URL: '' })).toBeUndefined()
  })
})
