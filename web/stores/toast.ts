import { defineStore } from 'pinia'

export type ToastKind = 'error' | 'success' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

// Global ephemeral notifications. Any component/composable can push a toast; the single
// LayoutToastHost (mounted in AppShell) renders the stack. Auto-dismiss after a timeout.
export const useToastStore = defineStore('toast', () => {
  const toasts = ref<ToastItem[]>([])
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const dismiss = (id: number) => {
    toasts.value = toasts.value.filter(t => t.id !== id)
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  const push = (kind: ToastKind, message: string, ms = 6000) => {
    const id = ++nextId
    toasts.value = [...toasts.value, { id, kind, message }]
    if (ms > 0) {
      timers.set(id, setTimeout(() => dismiss(id), ms))
    }
    return id
  }

  // Auto-dismiss timers are real setTimeouts outliving this store's own lifetime would leave
  // them firing against a torn-down app (crashes a Vue patch trying to update removed DOM) - tie
  // their cleanup to the store's effect scope so disposing the store (app/Pinia teardown) cancels
  // every pending one.
  onScopeDispose(() => {
    timers.forEach(timer => clearTimeout(timer))
    timers.clear()
  })

  const error = (message: string) => push('error', message)
  const success = (message: string) => push('success', message)
  const info = (message: string) => push('info', message)

  return { toasts, push, error, success, info, dismiss }
})
