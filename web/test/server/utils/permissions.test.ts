import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const findManyMock = vi.fn()

vi.mock('~/server/utils/prisma', () => ({
  prisma: { rolePermission: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}))

describe('permissions', () => {
  beforeEach(async () => {
    vi.resetModules()
    findManyMock.mockReset()
    const { invalidatePermissionCache } = await import('../../../server/utils/permissions')
    invalidatePermissionCache()
  })

  it('hasPermission reflects the DB-backed matrix', async () => {
    findManyMock.mockResolvedValue([{ role: 'MANAGER', permission: 'sync.view' }])
    const { hasPermission } = await import('../../../server/utils/permissions')
    expect(await hasPermission('MANAGER', 'sync.view')).toBe(true)
    expect(await hasPermission('MANAGER', 'variables.edit')).toBe(false)
  })

  it('caches the matrix across calls (single findMany call)', async () => {
    findManyMock.mockResolvedValue([{ role: 'ADMIN', permission: 'issues.view' }])
    const { hasPermission } = await import('../../../server/utils/permissions')
    await hasPermission('ADMIN', 'issues.view')
    await hasPermission('ADMIN', 'issues.view')
    expect(findManyMock).toHaveBeenCalledOnce()
  })

  it('invalidatePermissionCache forces a reload', async () => {
    findManyMock.mockResolvedValue([])
    const { hasPermission, invalidatePermissionCache } = await import('../../../server/utils/permissions')
    await hasPermission('VIEWER', 'play.view')
    invalidatePermissionCache()
    await hasPermission('VIEWER', 'play.view')
    expect(findManyMock).toHaveBeenCalledTimes(2)
  })

  it('an empty RolePermission table (fresh DB / failed seed) falls back to DEFAULT_MATRIX instead of locking everyone out', async () => {
    findManyMock.mockResolvedValue([])
    const { hasPermission } = await import('../../../server/utils/permissions')
    expect(await hasPermission('ADMIN', 'issues.view')).toBe(true)
    expect(await hasPermission('VIEWER', 'play.view')).toBe(true)
    expect(await hasPermission('VIEWER', 'variables.edit')).toBe(false)
  })

  it('MANAGER holds sync.run/downloads.crud (not just the VIEW-only sync.view) so terminal runs and download mutations aren\'t gated by a view permission (docs audit #29)', async () => {
    findManyMock.mockResolvedValue([])
    const { hasPermission } = await import('../../../server/utils/permissions')
    expect(await hasPermission('MANAGER', 'sync.run')).toBe(true)
    expect(await hasPermission('MANAGER', 'downloads.crud')).toBe(true)
    expect(await hasPermission('VIEWER', 'sync.run')).toBe(false)
    expect(await hasPermission('VIEWER', 'downloads.crud')).toBe(false)
  })

  it('getPermissionsForRole returns a sorted list', async () => {
    findManyMock.mockResolvedValue([
      { role: 'ADMIN', permission: 'sync.view' },
      { role: 'ADMIN', permission: 'issues.view' },
    ])
    const { getPermissionsForRole } = await import('../../../server/utils/permissions')
    expect(await getPermissionsForRole('ADMIN')).toEqual(['issues.view', 'sync.view'])
  })

  it('requirePermission throws 401 when there is no user', async () => {
    findManyMock.mockResolvedValue([])
    const { requirePermission } = await import('../../../server/utils/permissions')
    const event = { context: {} } as H3Event
    await expect(requirePermission(event, 'play.view')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('requirePermission throws 403 when the role lacks the permission', async () => {
    findManyMock.mockResolvedValue([])
    const { requirePermission } = await import('../../../server/utils/permissions')
    const event = { context: { user: { role: 'VIEWER' } } } as unknown as H3Event
    await expect(requirePermission(event, 'issues.view')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('requirePermission resolves when the role has the permission', async () => {
    findManyMock.mockResolvedValue([{ role: 'VIEWER', permission: 'play.view' }])
    const { requirePermission } = await import('../../../server/utils/permissions')
    const event = { context: { user: { role: 'VIEWER' } } } as unknown as H3Event
    await expect(requirePermission(event, 'play.view')).resolves.toBeUndefined()
  })

  it('requireRole throws 401 with no user, 403 on role mismatch, resolves on match', async () => {
    const { requireRole } = await import('../../../server/utils/permissions')
    expect(() => requireRole({ context: {} } as H3Event, 'ADMIN')).toThrow(expect.objectContaining({ statusCode: 401 }))
    expect(() => requireRole({ context: { user: { role: 'VIEWER' } } } as unknown as H3Event, 'ADMIN'))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(() => requireRole({ context: { user: { role: 'ADMIN' } } } as unknown as H3Event, 'ADMIN')).not.toThrow()
  })
})
