import { getMosaicProcess, setMosaicProcess } from '~/server/utils/mosaic'
import { requireRoleAtLeast } from '~/server/utils/permissions'

export default defineEventHandler(async (event): Promise<{ ok: boolean; message?: string }> => {
  // Matches generate.post.ts's gating - cancelling affects the one global mosaic slot for everyone.
  requireRoleAtLeast(event, 'MANAGER')

  const proc = getMosaicProcess()
  if (proc) {
    proc.kill('SIGTERM')
    setMosaicProcess(null)
    return { ok: true }
  }

  const { remoteServerUrl } = useRuntimeConfig()
  if (remoteServerUrl) {
    const cookie = getRequestHeader(event, 'cookie') || ''
    return $fetch<{ ok: boolean }>(`${remoteServerUrl}/api/labs/mosaic/cancel`, {
      method: 'POST',
      headers: { cookie },
    })
  }

  return { ok: true, message: 'No process running' }
})
