import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { encryptStoredSecrets } from '../../../server/utils/settingsEncryption'
import { getSettingsRow } from '../../../server/utils/settings'
import { getUserLastfmSession, saveUserLastfmSession } from '../../../server/utils/lastfmSessions'
import { isEncryptedSecret } from '../../../server/utils/secretBox'

// Real Postgres: the boot pass is a set of guarded UPDATEs, and the guard (only rewrite a value that is still the
// plaintext that was read) is a DB-level property.
const prisma = getTestPrisma()

// resetDb keeps the Settings row between tests, so each test starts by clearing the secrets it may have left.
const NO_SECRETS = { slskdApiKey: null, awsSecretAccessKey: null, fanartApiKey: null, lastfmSecret: null, lastfmSessionKey: null, geniusSecret: null, geniusAccessToken: null, slskdUrl: null }
const clearSecrets = () => prisma.settings.upsert({ where: { id: 'main' }, create: { id: 'main' }, update: NO_SECRETS })

describe('encrypting stored secrets (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    await clearSecrets()
    process.env.SETTINGS_ENCRYPTION_KEY = 'e'.repeat(40)
  })

  afterEach(async () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY
    await clearSecrets()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('encrypts every plaintext secret, leaves the rest alone, and reads back the same values', async () => {
    await prisma.settings.update({
      where: { id: 'main' },
      data: { slskdApiKey: 'slskd-key', fanartApiKey: 'fanart-key', lastfmSecret: 'lfm', slskdUrl: 'http://slskd' },
    })

    expect(await encryptStoredSecrets()).toBe(3)

    const raw = await prisma.settings.findUniqueOrThrow({ where: { id: 'main' } })
    expect(isEncryptedSecret(raw.slskdApiKey!)).toBe(true)
    expect(isEncryptedSecret(raw.fanartApiKey!)).toBe(true)
    expect(isEncryptedSecret(raw.lastfmSecret!)).toBe(true)
    expect(raw.geniusSecret).toBeNull()
    expect(raw.slskdUrl).toBe('http://slskd')

    const read = await getSettingsRow({ fresh: true })
    expect(read?.slskdApiKey).toBe('slskd-key')
    expect(read?.fanartApiKey).toBe('fanart-key')
    expect(read?.lastfmSecret).toBe('lfm')
  })

  it('is a no-op the second time', async () => {
    await prisma.settings.update({ where: { id: 'main' }, data: { slskdApiKey: 'k' } })
    expect(await encryptStoredSecrets()).toBe(1)
    expect(await encryptStoredSecrets()).toBe(0)
  })

  it('does nothing without a key, and nothing when there is nothing to encrypt', async () => {
    await prisma.settings.update({ where: { id: 'main' }, data: { slskdApiKey: 'k' } })
    delete process.env.SETTINGS_ENCRYPTION_KEY
    expect(await encryptStoredSecrets()).toBe(0)
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: 'main' } })).slskdApiKey).toBe('k')

    process.env.SETTINGS_ENCRYPTION_KEY = 'e'.repeat(40)
    await prisma.settings.update({ where: { id: 'main' }, data: { slskdApiKey: null } })
    expect(await encryptStoredSecrets()).toBe(0)
  })

  it('encrypts Last.fm sessions too, and a session saved under a key is stored encrypted', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    await prisma.userLastfmSession.create({ data: { userId: alice.id, sessionKey: 'legacy-plain', username: 'alice' } })

    expect(await encryptStoredSecrets()).toBe(1)
    expect(isEncryptedSecret((await prisma.userLastfmSession.findUniqueOrThrow({ where: { userId: alice.id } })).sessionKey)).toBe(true)
    expect(await getUserLastfmSession(alice.id)).toEqual({ sessionKey: 'legacy-plain', username: 'alice' })

    await saveUserLastfmSession(bob.id, { sessionKey: 'fresh', username: 'bob' })
    expect(isEncryptedSecret((await prisma.userLastfmSession.findUniqueOrThrow({ where: { userId: bob.id } })).sessionKey)).toBe(true)
    expect(await getUserLastfmSession(bob.id)).toEqual({ sessionKey: 'fresh', username: 'bob' })
  })

  it('a session that can no longer be opened counts as not connected', async () => {
    const alice = await makeUser(prisma)
    await saveUserLastfmSession(alice.id, { sessionKey: 'k', username: 'alice' })

    process.env.SETTINGS_ENCRYPTION_KEY = 'f'.repeat(40)
    expect(await getUserLastfmSession(alice.id)).toBeNull()
  })
})
