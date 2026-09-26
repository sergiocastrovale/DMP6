import { describe, expect, it } from 'vitest'
import { isDownloadWrite } from '../../../server/utils/downloadEvents'

describe('isDownloadWrite', () => {
  it('recognises the SQL Prisma logs for a write to a download row', () => {
    expect(isDownloadWrite('UPDATE "public"."DownloadedRelease" SET "status" = $1, "updatedAt" = $2 WHERE ("public"."DownloadedRelease"."id" = $3 AND 1=1)')).toBe(true)
    expect(isDownloadWrite('INSERT INTO "public"."DownloadedRelease" ("id","title") VALUES ($1,$2)')).toBe(true)
    expect(isDownloadWrite('DELETE FROM "public"."DownloadedRelease" WHERE "public"."DownloadedRelease"."id" IN ($1)')).toBe(true)
    expect(isDownloadWrite('  \n UPDATE "public"."DownloadedRelease" SET x = 1')).toBe(true)
  })

  it('ignores reads, transaction control and other tables', () => {
    expect(isDownloadWrite('SELECT "public"."DownloadedRelease"."id" FROM "public"."DownloadedRelease" WHERE 1=1')).toBe(false)
    expect(isDownloadWrite('UPDATE "public"."LocalRelease" SET "title" = $1')).toBe(false)
    expect(isDownloadWrite('INSERT INTO "public"."DownloadedReleaseFile" ("id") VALUES ($1)')).toBe(false)
    expect(isDownloadWrite('BEGIN')).toBe(false)
    expect(isDownloadWrite('COMMIT')).toBe(false)
  })
})
