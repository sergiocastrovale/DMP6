import { apiErrorMessage, shouldReportError } from '~/helpers/apiError'

// Runs a user-triggered request and turns a failure into a toast instead of a silent `catch {}`. Background polls
// stay out of this on purpose: a stale badge is not worth interrupting anyone for.
//   run  - an action (favorite, save, delete): resolves true when it worked.
//   load - a read the user asked for: resolves with the value, or null after reporting the failure.
export const useApi = () => {
  const toast = useToastStore()

  const report = (e: unknown, fallback: string) => {
    if (shouldReportError(e)) {
      toast.error(apiErrorMessage(e, fallback))
    }
  }

  const run = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    try {
      await fn()
      return true
    }
    catch (e) {
      report(e, fallback)
      return false
    }
  }

  const load = async <T>(fn: () => Promise<T>, fallback: string): Promise<T | null> => {
    try {
      return await fn()
    }
    catch (e) {
      report(e, fallback)
      return null
    }
  }

  return { run, load, report }
}
