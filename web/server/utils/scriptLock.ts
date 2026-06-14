// In-process serializer for Rust script invocations (index / sync / catalogue-gaps).
//
// The Rust binaries share ONE exclusive DB lock (Statistics.scanLockedBy) and hard-exit(1) if it's
// already held. The gaps worker, merges, and any other automated run live in the same Nitro process,
// so a single promise-chain mutex here guarantees they never collide on that lock. Manual terminal
// runs are outside this process; the binaries' 10-min stale-lock auto-clear covers crashes.

let chain: Promise<unknown> = Promise.resolve()

/** Run `fn` exclusively with respect to every other runExclusive() call in this process. */
export const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const result = chain.then(fn, fn)
  // Keep the chain alive regardless of this run's outcome.
  chain = result.then(() => {}, () => {})
  return result
}
