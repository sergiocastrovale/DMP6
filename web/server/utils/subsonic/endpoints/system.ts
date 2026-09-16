import type { H3Event } from 'h3'
import { SubsonicApiError, SubsonicErrorCode } from '~/server/utils/subsonic/errors'
import { OPEN_SUBSONIC_EXTENSIONS } from '~/server/utils/subsonic/response'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

export const ping = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => ({})

export const getLicense = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => ({
  license: { valid: true },
})

export const getMusicFolders = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => ({
  musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] },
})

export const getOpenSubsonicExtensions = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => ({
  openSubsonicExtensions: OPEN_SUBSONIC_EXTENSIONS,
})

// Every DMP role can view its own account only - there's no cross-user admin view in v1.
export const getUser = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const username = ctx.params.str('username') ?? ctx.user.username
  if (username !== ctx.user.username) {
    throw new SubsonicApiError(SubsonicErrorCode.NOT_AUTHORIZED, 'Cannot view another user')
  }
  const isAdmin = ctx.user.role === 'ADMIN'
  return {
    user: {
      username: ctx.user.username,
      email: ctx.user.email,
      scrobblingEnabled: true,
      adminRole: isAdmin,
      settingsRole: isAdmin,
      downloadRole: true,
      uploadRole: false,
      playlistRole: true,
      coverArtRole: true,
      commentRole: false,
      podcastRole: false,
      streamRole: true,
      jukeboxRole: false,
      shareRole: false,
      videoConversionRole: false,
    },
  }
}
