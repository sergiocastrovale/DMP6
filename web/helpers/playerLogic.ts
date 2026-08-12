// Pure logic extracted from stores/player.ts so it's unit-testable without a Pinia/DOM/fetch stack.

export const QUEUE_PERSIST_CAP = 200

// Explorer session history is browsable from /explore, so it keeps a much shorter tail than the queue.
export const EXPLORER_SESSION_HISTORY_CAP = 50

// Fisher-Yates shuffle, in place. Returns the same array reference.
export function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

// A play counts as a scrobble once past 30s of duration and either half-listened or 4 minutes in.
export function shouldScrobble(state: { duration: number, currentTime: number }): boolean {
  if (state.duration < 30) {return false}
  return state.currentTime > state.duration * 0.5 || state.currentTime > 240
}

// FIFO cap: push to the end, drop from the front once over `cap`. Mutates `arr` in place.
export function pushCapped<T>(arr: T[], item: T, cap: number): void {
  arr.push(item)
  if (arr.length > cap) {arr.shift()}
}

// LIFO cap: unshift to the front, drop from the back once over `cap`. Mutates `arr` in place.
export function unshiftCapped<T>(arr: T[], item: T, cap: number): void {
  arr.unshift(item)
  if (arr.length > cap) {arr.length = cap}
}

// Index of the next item in a wrapping queue. Null when the queue is empty. `currentIndex` of -1
// (current track not found in the queue) naturally wraps to 0, same as "start from the top".
export function nextIndexWrap(length: number, currentIndex: number): number | null {
  if (length === 0) {return null}
  return (currentIndex + 1) % length
}

// Slice a queue down to the last `cap` entries before persisting to localStorage.
export function sliceForPersist<T>(arr: T[], cap: number = QUEUE_PERSIST_CAP): T[] {
  return arr.slice(-cap)
}
