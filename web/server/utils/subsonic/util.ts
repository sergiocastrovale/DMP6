export const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)

// Fisher-Yates, in place. Used for getRandomSongs/getAlbumList2's `random` - avoids `ORDER BY
// random()` over a large table (O(n log n) per call) by sampling a bounded candidate pool first
// and shuffling just that in JS.
export const shuffleInPlace = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}
