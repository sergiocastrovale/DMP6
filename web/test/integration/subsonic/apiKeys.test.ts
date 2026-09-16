import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { createApiKey, listApiKeys, resolveApiKey, revokeApiKey } from '../../../server/utils/apiKeys'

const prisma = getTestPrisma()

describe('Subsonic API keys (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a freshly created key resolves back to its owning user', async () => {
    const alice = await makeUser(prisma)
    const { key } = await createApiKey(alice.id, 'My Phone')

    const resolved = await resolveApiKey(key)
    expect(resolved?.id).toBe(alice.id)
    expect(resolved?.username).toBe(alice.username)
  })

  it('an unknown key resolves to null', async () => {
    expect(await resolveApiKey('dmp_not-a-real-key')).toBeNull()
  })

  it('a revoked key stops resolving', async () => {
    const alice = await makeUser(prisma)
    const { id, key } = await createApiKey(alice.id, 'My Phone')

    await revokeApiKey(alice.id, id)

    expect(await resolveApiKey(key)).toBeNull()
  })

  it('revoking another user\'s key 404s rather than leaking which ids exist', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const { id } = await createApiKey(alice.id, 'My Phone')

    await expect(revokeApiKey(bob.id, id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('revoking an already-revoked key 404s (not silently a no-op)', async () => {
    const alice = await makeUser(prisma)
    const { id } = await createApiKey(alice.id, 'My Phone')
    await revokeApiKey(alice.id, id)

    await expect(revokeApiKey(alice.id, id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('listApiKeys never includes the hash and is scoped to the caller', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    await createApiKey(alice.id, 'Alice key')
    await createApiKey(bob.id, 'Bob key')

    const aliceKeys = await listApiKeys(alice.id)
    expect(aliceKeys).toHaveLength(1)
    expect(aliceKeys[0]!.name).toBe('Alice key')
    expect(aliceKeys[0]).not.toHaveProperty('keyHash')
  })

  it('a mustChangePassword user\'s key still resolves - the /rest dispatcher itself refuses it', async () => {
    const alice = await makeUser(prisma, { mustChangePassword: true })
    const { key } = await createApiKey(alice.id, 'My Phone')
    const resolved = await resolveApiKey(key)
    expect(resolved?.mustChangePassword).toBe(true)
  })
})
