import * as mediasoup from 'mediasoup'
import { setPartyWorker } from '../utils/party'

export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig()
  
  // Only initialize mediasoup if party mode is enabled and role is listener
  if (!config.public.partyEnabled || config.public.partyRole !== 'listener') {
    return
  }

  console.log('[mediasoup] Initializing mediasoup for party mode!')

  const rtcMinPort = Number(config.rtcMinPort) || 10000
  const rtcMaxPort = Number(config.rtcMaxPort) || 10100

  try {
    const worker = await mediasoup.createWorker({
      rtcMinPort,
      rtcMaxPort,
      logLevel: 'warn',
    })

    worker.on('died', () => {
      console.error('[mediasoup] Worker died, restarting in 2s...')
      setTimeout(async () => {
        try {
          const newWorker = await mediasoup.createWorker({
            rtcMinPort,
            rtcMaxPort,
            logLevel: 'warn',
          })
          newWorker.on('died', () => {
            console.error('[mediasoup] Worker died again. Manual restart required.')
          })
          setPartyWorker(newWorker)
          console.log('[mediasoup] Worker restarted successfully')
        }
        catch (err) {
          console.error('[mediasoup] Failed to restart worker:', err)
        }
      }, 2000)
    })

    setPartyWorker(worker)
    console.log(`[mediasoup] Worker started [pid:${worker.pid}, ports:${rtcMinPort}-${rtcMaxPort}]`)
  }
  catch (err) {
    console.error('[mediasoup] Failed to create worker:', err)
  }
})
