// Pure module-level stack tracking which dialogs are currently open, topmost last. `Dialog.vue` is
// the app's only dialog shell, but it renders through <Teleport to="body">, so two open dialogs are
// siblings in the DOM with no parent/child relationship to lean on - each dialog instance registers
// itself here instead, so only the TOP one reacts to Escape, and body scroll stays locked until the
// LAST one closes rather than the first one to unmount.
const stack: symbol[] = []

export const push = (id: symbol): void => {
  if (!stack.includes(id)) {
    stack.push(id)
  }
}

export const remove = (id: symbol): void => {
  const index = stack.indexOf(id)
  if (index !== -1) {
    stack.splice(index, 1)
  }
}

export const isTop = (id: symbol): boolean => stack.at(-1) === id

export const isEmpty = (): boolean => stack.length === 0
