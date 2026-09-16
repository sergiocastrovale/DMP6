import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { createApiKey } from '../../../server/utils/apiKeys'
import { authenticateSubsonicRequest } from '../../../server/utils/subsonic/auth'
import { makeParams } from '../../../server/utils/subsonic/params'
import { SubsonicApiError, SubsonicErrorCode } from '../../../server/utils/subsonic/errors'

const prisma = getTestPrisma()

// Just enough of an H3Event for getRequestHeader/the throttle key builder to read - the request
// itself (method/url/body) is irrelevant to authenticateSubsonicRequest.
const fakeEvent = (ip = '127.0.0.1'): H3Event =>
  ({ node: { req: { headers: {}, socket: { remoteAddress: ip } } } }) as unknown as H3Event

describe('Subsonic /rest authentication (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a valid apiKey resolves to its owning user', async () => {
    const alice = await makeUser(prisma)
    const { key } = await createApiKey(alice.id, 'Phone')

    const user = await authenticateSubsonicRequest(fakeEvent(), makeParams({ apiKey: key }))
    expect(user.username).toBe(alice.username)
  })

  it('u/p/t without an apiKey is refused with code 42 (not silently ignored)', async () => {
    await expect(authenticateSubsonicRequest(fakeEvent(), makeParams({ u: 'alice', p: 'enc:x', v: '1.16.1', c: 'test' })))
      .rejects.toMatchObject({ code: SubsonicErrorCode.PASSWORD_AUTH_NOT_SUPPORTED })
  })

  it('apiKey combined with u/p/t is refused with code 43', async () => {
    const alice = await makeUser(prisma)
    const { key } = await createApiKey(alice.id, 'Phone')
    await expect(authenticateSubsonicRequest(fakeEvent(), makeParams({ apiKey: key, u: 'alice' })))
      .rejects.toMatchObject({ code: SubsonicErrorCode.MULTIPLE_CONFLICTING_AUTH })
  })

  it('an unknown apiKey is refused with code 44', async () => {
    await expect(authenticateSubsonicRequest(fakeEvent(), makeParams({ apiKey: 'dmp_not-real' })))
      .rejects.toMatchObject({ code: SubsonicErrorCode.INVALID_API_KEY })
  })

  it('a revoked apiKey is refused with code 44', async () => {
    const alice = await makeUser(prisma)
    const { id, key } = await createApiKey(alice.id, 'Phone')
    await prisma.userApiKey.update({ where: { id }, data: { revokedAt: new Date() } })

    await expect(authenticateSubsonicRequest(fakeEvent(), makeParams({ apiKey: key })))
      .rejects.toMatchObject({ code: SubsonicErrorCode.INVALID_API_KEY })
  })

  it('a mustChangePassword user\'s apiKey is refused with code 50', async () => {
    const alice = await makeUser(prisma, { mustChangePassword: true })
    const { key } = await createApiKey(alice.id, 'Phone')

    await expect(authenticateSubsonicRequest(fakeEvent(), makeParams({ apiKey: key })))
      .rejects.toMatchObject({ code: SubsonicErrorCode.NOT_AUTHORIZED })
  })

  it('repeated invalid keys from the same IP eventually lock out further attempts', async () => {
    const ip = '10.0.0.1'
    let lastError: unknown
    for (let i = 0; i < 8; i++) {
      try {
        await authenticateSubsonicRequest(fakeEvent(ip), makeParams({ apiKey: 'dmp_bad' }))
      }
      catch (e) {
        lastError = e
      }
    }
    expect(lastError).toBeInstanceOf(SubsonicApiError)
    expect((lastError as SubsonicApiError).message).toMatch(/too many failed attempts/i)
  })
})
