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
  geniusClientId: string | null
  geniusSecret: string | null
  geniusAccessToken: string | null
  lastfmApiKey: string | null
  lastfmSecret: string | null
}

export type ParsedIntField =
  | { ok: true, value: number | null | undefined }
  | { ok: false }

// What one Last.fm call needs: the application's key and secret (global) plus the calling user's session key.
export interface LastfmSettings {
  lastfmApiKey: string | null
  lastfmSecret: string | null
  lastfmSessionKey: string | null
}
