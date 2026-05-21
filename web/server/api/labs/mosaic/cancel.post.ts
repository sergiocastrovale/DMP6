import { getMosaicProcess, setMosaicProcess } from '~/server/utils/mosaic'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const proc = getMosaicProcess()
  if (proc) {
    proc.kill('SIGTERM')
    setMosaicProcess(null)
    return { ok: true }
  }

  const { remoteServerUrl } = useRuntimeConfig()
  if (remoteServerUrl) {
    const cookie = getRequestHeader(event, 'cookie') || ''
    return $fetch(`${remoteServerUrl}/api/labs/mosaic/cancel`, {
      method: 'POST',
      headers: { cookie },
    })
  }

  return { ok: true, message: 'No process running' }
})
