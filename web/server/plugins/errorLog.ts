import { formatServerError, isServerError, statusOf } from '~/server/utils/serverErrorLog'

// Nitro's default is to print nothing useful for an unhandled 500. This logs every 5xx with the request it came from.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    event.context.startedAt = Date.now()
  })

  nitroApp.hooks.hook('error', (error, ctx) => {
    const status = statusOf(error)
    if (!isServerError(status)) {
      return
    }
    const event = ctx?.event
    const startedAt = event?.context.startedAt as number | undefined
    console.error(formatServerError({
      method: event?.method ?? '-',
      path: event ? getRequestURL(event).pathname : '-',
      status,
      userId: (event?.context.user as { id?: number } | undefined)?.id ?? null,
      durationMs: startedAt ? Date.now() - startedAt : null,
      error,
    }))
  })
})
