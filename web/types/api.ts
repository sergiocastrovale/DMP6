export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface CachedSettings {
  musicDir: string
  imageStorage: string
  storageImageBucket: string
  storageBackupsBucket: string
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  storageEndpoint: string
  storagePublicUrl: string
  fanartApiKey: string
  lastfmApiKey: string | null
  lastfmSecret: string | null
  lastfmSessionKey: string | null
  lastfmUsername: string | null
  showTerminal: boolean
}

export type ParsedIntField =
  | { ok: true, value: number | null | undefined }
  | { ok: false }

export type LastfmSettings = Pick<import('@prisma/client').Settings, 'lastfmApiKey' | 'lastfmSecret' | 'lastfmSessionKey' | 'lastfmUsername'>
