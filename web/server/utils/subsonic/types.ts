import type { SessionUser } from '~/types/auth'
import type { SubsonicParams } from './params'
import type { SubsonicFormat } from './response'

export interface HandlerContext {
  user: SessionUser
  params: SubsonicParams
  format: SubsonicFormat
}
