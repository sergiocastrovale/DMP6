import { describe, expect, it } from 'vitest'
import { classifyReleaseType } from '../../../server/utils/releaseTypeBuckets'

const base = { typeSlug: 'album' as string | null, secondaryTypes: [] as string[], mediumCount: 1 as number | null, packaging: null as string | null }

describe('classifyReleaseType', () => {
  it('classifies a plain album', () => {
    expect(classifyReleaseType(base)).toBe('album')
  })

  it('classifies an EP', () => {
    expect(classifyReleaseType({ ...base, typeSlug: 'ep' })).toBe('ep')
  })

  it('classifies a single', () => {
    expect(classifyReleaseType({ ...base, typeSlug: 'single' })).toBe('single')
  })

  it('has no MB link -> unknown', () => {
    expect(classifyReleaseType({ ...base, typeSlug: null })).toBe('unknown')
  })

  it('a 2-disc release is not a box set - just multi-medium', () => {
    expect(classifyReleaseType({ ...base, mediumCount: 2 })).toBe('album')
  })

  it('a 3+ disc release is a box set', () => {
    expect(classifyReleaseType({ ...base, mediumCount: 3 })).toBe('box-set')
  })

  it('packaging=Box is a box set even with one medium', () => {
    expect(classifyReleaseType({ ...base, mediumCount: 1, packaging: 'Box' })).toBe('box-set')
  })

  it('box set wins over compilation', () => {
    expect(classifyReleaseType({ ...base, mediumCount: 3, secondaryTypes: ['Compilation'] })).toBe('box-set')
  })

  it('compilation wins over live', () => {
    expect(classifyReleaseType({ ...base, secondaryTypes: ['Live', 'Compilation'] })).toBe('compilation')
  })

  it('live beats the ep/single/album primary type', () => {
    expect(classifyReleaseType({ ...base, typeSlug: 'ep', secondaryTypes: ['Live'] })).toBe('live')
  })

  it('soundtrack is its own bucket, below live', () => {
    expect(classifyReleaseType({ ...base, secondaryTypes: ['Soundtrack'] })).toBe('soundtrack')
  })

  it('an unrecognized primary type (e.g. "Other") falls back to unknown', () => {
    expect(classifyReleaseType({ ...base, typeSlug: 'other' })).toBe('unknown')
  })
})
