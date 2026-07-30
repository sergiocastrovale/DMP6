import { vi } from 'vitest'

// Node 22+ exposes a native `globalThis.localStorage`, but it throws unless launched with
// --localstorage-file. stores/player.ts reads/writes localStorage at store-setup time (session
// persistence), so any test that touches usePlayerStore needs a working implementation. happy-dom
// provides one in the `unit` project; the `nuxt` project's environment does not, so stub a minimal
// in-memory Storage here.
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length(): number { return this.map.size }
  clear(): void { this.map.clear() }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null }
  removeItem(key: string): void { this.map.delete(key) }
  setItem(key: string, value: string): void { this.map.set(key, String(value)) }
}

vi.stubGlobal('localStorage', new MemoryStorage())
