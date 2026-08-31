import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'

const prisma = getTestPrisma()

const makeEvent = (message: string, overrides: { level?: string, archivedAt?: Date | null } = {}) =>
  prisma.monitorEvent.create({
    data: {
      level: overrides.level ?? 'warn',
      message,
      archivedAt: overrides.archivedAt ?? null,
    },
  })

describe('monitor events (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lists flagged and archived separately', async () => {
    const { listMonitorEvents } = await import('../../../server/utils/monitorEvents')

    await makeEvent('still flagged')
    await makeEvent('already archived', { archivedAt: new Date() })

    const flagged = await listMonitorEvents({ archived: false, limit: 50 })
    const archived = await listMonitorEvents({ archived: true, limit: 50 })

    expect(flagged.map(e => e.message)).toEqual(['still flagged'])
    expect(archived.map(e => e.message)).toEqual(['already archived'])
  })

  it('counts both lists independently of the page limit', async () => {
    const { monitorEventCounts, listMonitorEvents } = await import('../../../server/utils/monitorEvents')

    for (let i = 0; i < 5; i++) { await makeEvent(`flagged ${i}`) }
    await makeEvent('archived one', { archivedAt: new Date() })

    // The badge must report the total, not what a capped page happened to return.
    const page = await listMonitorEvents({ archived: false, limit: 2 })
    expect(page).toHaveLength(2)
    expect(await monitorEventCounts()).toEqual({ flagged: 5, archived: 1 })
  })

  it('archives the given ids and leaves the rest flagged', async () => {
    const { archiveMonitorEvents, monitorEventCounts } = await import('../../../server/utils/monitorEvents')

    const a = await makeEvent('archive me')
    await makeEvent('leave me')

    expect(await archiveMonitorEvents([a.id])).toBe(1)
    expect(await monitorEventCounts()).toEqual({ flagged: 1, archived: 1 })
  })

  it('re-archiving is idempotent and does not move the original timestamp', async () => {
    const { archiveMonitorEvents } = await import('../../../server/utils/monitorEvents')

    const e = await makeEvent('archive me')
    expect(await archiveMonitorEvents([e.id])).toBe(1)
    const first = await prisma.monitorEvent.findUniqueOrThrow({ where: { id: e.id } })

    // Second pass reports 0 changed - not 1 - and the timestamp stands.
    expect(await archiveMonitorEvents([e.id])).toBe(0)
    const second = await prisma.monitorEvent.findUniqueOrThrow({ where: { id: e.id } })
    expect(second.archivedAt).toEqual(first.archivedAt)
  })

  it('restores archived rows and ignores ones already flagged', async () => {
    const { restoreMonitorEvents, monitorEventCounts } = await import('../../../server/utils/monitorEvents')

    const archived = await makeEvent('bring me back', { archivedAt: new Date() })
    const flagged = await makeEvent('never left')

    expect(await restoreMonitorEvents([archived.id, flagged.id])).toBe(1)
    expect(await monitorEventCounts()).toEqual({ flagged: 2, archived: 0 })
  })

  it('deletes only the ids given', async () => {
    const { deleteMonitorEvents, monitorEventCounts } = await import('../../../server/utils/monitorEvents')

    const doomed = await makeEvent('delete me')
    await makeEvent('keep me')

    expect(await deleteMonitorEvents({ ids: [doomed.id] })).toBe(1)
    expect(await monitorEventCounts()).toEqual({ flagged: 1, archived: 0 })
  })

  it('allArchived never touches a flagged row', async () => {
    const { deleteMonitorEvents, monitorEventCounts } = await import('../../../server/utils/monitorEvents')

    await makeEvent('archived 1', { archivedAt: new Date() })
    await makeEvent('archived 2', { archivedAt: new Date() })
    await makeEvent('still flagged')

    expect(await deleteMonitorEvents({ allArchived: true })).toBe(2)
    // Emptying the Archived list must not discard issues nobody has dismissed yet.
    expect(await monitorEventCounts()).toEqual({ flagged: 1, archived: 0 })
  })

  it('refuses a delete that names neither ids nor allArchived', async () => {
    const { deleteMonitorEvents, monitorEventCounts } = await import('../../../server/utils/monitorEvents')

    await makeEvent('do not delete me')

    // "Delete nothing in particular" must not fall through to "delete everything".
    await expect(deleteMonitorEvents({})).rejects.toThrow(/ids or allArchived/)
    await expect(deleteMonitorEvents({ ids: [] })).rejects.toThrow(/ids or allArchived/)
    expect(await monitorEventCounts()).toEqual({ flagged: 1, archived: 0 })
  })

  it('clamps the page limit to the endpoint ceiling', async () => {
    const { clampEventLimit, MAX_EVENT_LIMIT } = await import('../../../server/utils/monitorEvents')

    expect(clampEventLimit(undefined)).toBe(50)
    expect(clampEventLimit('10')).toBe(10)
    expect(clampEventLimit('99999')).toBe(MAX_EVENT_LIMIT)
    expect(clampEventLimit('0')).toBe(50)
    expect(clampEventLimit('-5')).toBe(1)
  })
})
