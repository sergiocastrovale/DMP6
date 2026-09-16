import type { H3Event } from 'h3'
import { requirePermission } from '~/server/utils/permissions'
import { authenticateSubsonicRequest } from '~/server/utils/subsonic/auth'
import { makeParams } from '~/server/utils/subsonic/params'
import { subsonicOk, subsonicError, type SubsonicFormat } from '~/server/utils/subsonic/response'
import { mapErrorToSubsonic, SubsonicErrorCode, SubsonicApiError } from '~/server/utils/subsonic/errors'
import * as system from '~/server/utils/subsonic/endpoints/system'
import * as browse from '~/server/utils/subsonic/endpoints/browse'
import * as lists from '~/server/utils/subsonic/endpoints/lists'
import * as search from '~/server/utils/subsonic/endpoints/search'
import * as media from '~/server/utils/subsonic/endpoints/media'
import * as annotation from '~/server/utils/subsonic/endpoints/annotation'
import * as playlists from '~/server/utils/subsonic/endpoints/playlists'
import type { HandlerContext } from '~/server/utils/subsonic/types'
import type { XmlObject } from '~/server/utils/subsonic/xml'

type JsonHandler = (event: H3Event, ctx: HandlerContext) => Promise<XmlObject>
// A raw handler writes its own response (stream/redirect/proxy) and must not be wrapped in the
// subsonic-response envelope.
type RawHandler = (event: H3Event, ctx: HandlerContext) => Promise<unknown>

// One entry per supported Subsonic REST endpoint, keyed by its name with the optional `.view`
// suffix stripped. See docs/feature_subsonic.md for what's covered in v1 and what's a follow-up.
const JSON_ENDPOINTS: Record<string, JsonHandler> = {
  ping: system.ping,
  getLicense: system.getLicense,
  getMusicFolders: system.getMusicFolders,
  getOpenSubsonicExtensions: system.getOpenSubsonicExtensions,
  getUser: system.getUser,
  getArtists: browse.getArtists,
  getArtist: browse.getArtist,
  getAlbum: browse.getAlbum,
  getSong: browse.getSong,
  getGenres: browse.getGenres,
  getAlbumList2: lists.getAlbumList2,
  getRandomSongs: lists.getRandomSongs,
  getStarred2: lists.getStarred2,
  search3: search.search3,
  star: annotation.star,
  unstar: annotation.unstar,
  scrobble: annotation.scrobble,
  getPlaylists: playlists.getPlaylists,
  getPlaylist: playlists.getPlaylist,
  createPlaylist: playlists.createPlaylist,
  deletePlaylist: playlists.deletePlaylist,
}

const RAW_ENDPOINTS: Record<string, RawHandler> = {
  stream: media.stream,
  download: media.download,
  getCoverArt: media.getCoverArt,
}

// GET-only clients send everything as query params; formPost (the OpenSubsonic extension advertised
// via getOpenSubsonicExtensions) sends credentials as a urlencoded POST body instead, so an apiKey
// never lands in a proxy/access log. h3's readBody parses either shape from Content-Type.
const readRawParams = async (event: H3Event): Promise<Record<string, unknown>> => {
  const query = getQuery(event) as Record<string, unknown>
  if (event.node.req.method !== 'POST') {return query}
  try {
    const body = await readBody(event)
    return { ...query, ...(body && typeof body === 'object' ? body : {}) }
  }
  catch {
    return query
  }
}

export default defineEventHandler(async (event) => {
  const rawPath = (getRouterParam(event, 'path') ?? '').replace(/\.view$/, '')
  const raw = await readRawParams(event)
  const params = makeParams(raw)
  const format: SubsonicFormat = raw.f === 'json' ? 'json' : 'xml'

  try {
    const user = await authenticateSubsonicRequest(event, params)
    // Mirrors what server/middleware/auth.ts sets from the session cookie, so requirePermission/
    // currentUserId work unchanged for every handler below.
    event.context.user = user
    await requirePermission(event, 'play.view')

    const ctx: HandlerContext = { user, params, format }

    const rawHandler = RAW_ENDPOINTS[rawPath]
    if (rawHandler) {
      return await rawHandler(event, ctx)
    }

    const jsonHandler = JSON_ENDPOINTS[rawPath]
    if (!jsonHandler) {
      throw new SubsonicApiError(SubsonicErrorCode.GENERIC, `Unknown endpoint '${rawPath}'`)
    }

    const body = await jsonHandler(event, ctx)
    if (format === 'xml') {
      setResponseHeader(event, 'Content-Type', 'text/xml; charset=UTF-8')
    }
    return subsonicOk(format, body)
  }
  catch (e) {
    const { code, message } = mapErrorToSubsonic(e)
    if (code === SubsonicErrorCode.GENERIC) {
      console.error(`[rest/${rawPath}]`, e)
    }
    // Subsonic failures are always HTTP 200 - the client reads status="failed"/<error> from the
    // envelope, never the HTTP status line.
    setResponseStatus(event, 200)
    if (format === 'xml') {
      setResponseHeader(event, 'Content-Type', 'text/xml; charset=UTF-8')
    }
    return subsonicError(format, code, message)
  }
})
