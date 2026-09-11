import { beforeEach, describe, expect, it } from 'vitest'
import { isEmpty, isTop, push, remove } from '../../helpers/dialogStack'

// The stack is module-level state, so every test needs a clean slate - each test tracks what it
// pushed and removes it in beforeEach, guarding against a leftover from a failed prior assertion.
describe('helpers/dialogStack.ts', () => {
  const ids: symbol[] = []

  beforeEach(() => {
    ids.forEach(remove)
    ids.length = 0
  })

  it('an empty stack reports empty and nothing is top', () => {
    expect(isEmpty()).toBe(true)
    expect(isTop(Symbol('x'))).toBe(false)
  })

  it('a single pushed dialog is both top and non-empty', () => {
    const a = Symbol('a')
    ids.push(a)
    push(a)
    expect(isTop(a)).toBe(true)
    expect(isEmpty()).toBe(false)
  })

  it('a second push makes the newer dialog top, the first no longer top', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    ids.push(a, b)
    push(a)
    push(b)
    expect(isTop(b)).toBe(true)
    expect(isTop(a)).toBe(false)
  })

  it('removing the top dialog restores the one underneath as top', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    ids.push(a, b)
    push(a)
    push(b)
    remove(b)
    expect(isTop(a)).toBe(true)
    expect(isEmpty()).toBe(false)
  })

  it('removing the last dialog empties the stack', () => {
    const a = Symbol('a')
    ids.push(a)
    push(a)
    remove(a)
    expect(isEmpty()).toBe(true)
  })

  it('pushing the same id twice does not create a duplicate entry', () => {
    const a = Symbol('a')
    ids.push(a)
    push(a)
    push(a)
    remove(a)
    expect(isEmpty()).toBe(true)
  })

  it('removing an id not on the stack is a no-op', () => {
    const a = Symbol('a')
    ids.push(a)
    push(a)
    remove(Symbol('never-pushed'))
    expect(isTop(a)).toBe(true)
  })
})
