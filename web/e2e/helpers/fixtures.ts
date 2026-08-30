// Prisma treats an `undefined` value in a `where` filter as "no condition on this field", not
// "match nothing" - `deleteMany({ where: { id: undefined } })` silently compiles to an
// unconditional delete of the *entire table*, cascading to everything that references it. This
// bit us for real: a spec's beforeAll fixture creation failed (a flaky DB connection under a
// heavy parallel run), its id variable was never assigned, and the afterAll cleanup that ran
// anyway - Playwright always runs afterAll, even when beforeAll throws - wiped every LocalRelease
// row (and everything cascading from it: LocalReleaseTrack, LocalReleaseArtist,
// TrackRelatedArtist) in the real database e2e runs against.
//
// `onlyId` turns a possibly-absent id into a `{ in: [...] }` filter, which has well-defined, safe
// semantics at every value: a real id matches just that row, an absent one produces `{ in: [] }`
// - a filter that can never match anything, i.e. a correct no-op instead of "match everything".
export const onlyId = (id: string | null | undefined) => ({ id: { in: id ? [id] : [] } })

// A second, independent layer, scoped per spec file (call once at module scope): skip cleanup
// entirely unless every part of setup actually finished. Call `markReady()` as the very last line
// of `beforeAll`, after every fixture create has succeeded, and check `isReady()` as the very
// first line of `afterAll`. If setup fails partway, nothing this test created exists to clean up
// - and no half-populated id variable ever reaches a delete call in the first place.
export const createReadyGuard = () => {
  let ready = false
  return {
    markReady: () => { ready = true },
    isReady: () => ready,
  }
}
