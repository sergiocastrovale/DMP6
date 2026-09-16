import { serveLocalImage } from '~/server/utils/serveImage'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  const match = path.match(/^\/img\/(artists|releases|labs)\/(.+)$/)
  if (!match) { return }

  const type = match[1] as 'artists' | 'releases' | 'labs'
  const filename = match[2]!

  if (filename.includes('..') || filename.includes('/')) { return }

  return serveLocalImage(event, type, filename)
})
