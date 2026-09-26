import { access, constants } from 'node:fs/promises'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMusicDir } from '~/server/utils/settings'
import { ffmpegAvailable } from '~/server/utils/transcode'
import { checkSlskdConnection } from '~/server/utils/slskd'
import type { DownloadEnvironment, DownloadEnvironmentCheck } from '~/types/download'

// Local instances (e.g. a dev box pointed at the shared prod DB) can see the full DownloadedRelease
// queue over the DB connection but have none of the physical prerequisites acquisition/merge need:
// the NAS's downloads volume mounted, MUSIC_DIR mounted, ffmpeg on PATH, or a reachable slskd. Every
// one of those failures used to only surface after a click (a 409 mid-merge, a raw acquire error, a
// FAILED transcode row) — this probes them up front so the UI can disable instead of error.
//
// `Settings.flacToMp3`/`FLAC_TO_MP3` on: ffmpeg is a hard merge blocker (transcodeDirToMp3320 already
// aborts the whole batch without it — see transcode.ts). Off: untranscoded formats pass straight
// through (layout.ts's TRACK_EXTENSIONS covers them), so ffmpeg is reported but non-blocking.


const checkPath = async (label: string, path: string, mode: number): Promise<DownloadEnvironmentCheck> => {
  if (!path) {return { ok: false, detail: `${label} not configured` }}
  const ok = await access(path, mode).then(() => true).catch(() => false)
  return ok ? { ok: true, detail: null } : { ok: false, detail: `${label} unreachable (${path})` }
}

let cached: { at: number, value: DownloadEnvironment } | null = null
const CACHE_TTL_MS = 10_000

const probeEnvironment = async (): Promise<DownloadEnvironment> => {
  const { downloadsPath, downloadsReadyPath, flacToMp3 } = await resolveDownloadSettings()
  const music = await resolveMusicDir()

  const [downloadsPathCheck, readyPathCheck, musicDirCheck, ffmpegOk, slskd] = await Promise.all([
    checkPath('staging path', downloadsPath, constants.R_OK | constants.W_OK),
    checkPath('ready folder', downloadsReadyPath, constants.R_OK),
    checkPath('library', music, constants.R_OK | constants.W_OK),
    ffmpegAvailable(),
    checkSlskdConnection(),
  ])

  const ffmpeg: DownloadEnvironmentCheck = ffmpegOk
    ? { ok: true, detail: null }
    : { ok: false, detail: 'ffmpeg not found on PATH' }

  return {
    downloadsPath: downloadsPathCheck,
    readyPath: readyPathCheck,
    musicDir: musicDirCheck,
    ffmpeg,
    ffmpegRequired: flacToMp3,
    slskd: slskd.ok ? { ok: true, detail: null } : { ok: false, detail: slskd.error ?? 'slskd unreachable' },
  }
}

export const checkDownloadEnvironment = async (force = false): Promise<DownloadEnvironment> => {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value
  }
  const value = await probeEnvironment()
  cached = { at: Date.now(), value }
  return value
}

export const clearDownloadEnvironmentCache = (): void => {
  cached = null
}

/** Pure — every reason acquisition can't proceed, given a probed environment. No filesystem access. */
export const acquireBlockReasons = (env: DownloadEnvironment): string[] => {
  const reasons: string[] = []
  if (!env.downloadsPath.ok) {reasons.push(env.downloadsPath.detail!)}
  if (!env.slskd.ok) {reasons.push(env.slskd.detail!)}
  return reasons
}

/** Pure — every reason merging can't proceed, given a probed environment. No filesystem access. */
export const mergeBlockReasons = (env: DownloadEnvironment): string[] => {
  const reasons: string[] = []
  if (!env.readyPath.ok) {reasons.push(env.readyPath.detail!)}
  if (!env.musicDir.ok) {reasons.push(env.musicDir.detail!)}
  if (env.ffmpegRequired && !env.ffmpeg.ok) {reasons.push(env.ffmpeg.detail!)}
  return reasons
}

export const assertCanAcquire = async (): Promise<void> => {
  const reasons = acquireBlockReasons(await checkDownloadEnvironment())
  if (reasons.length) {
    throw createError({ statusCode: 503, message: `Can't acquire downloads here: ${reasons.join('; ')}` })
  }
}

export const assertCanMerge = async (): Promise<void> => {
  const reasons = mergeBlockReasons(await checkDownloadEnvironment())
  if (reasons.length) {
    throw createError({ statusCode: 503, message: `Can't merge downloads here: ${reasons.join('; ')}` })
  }
}

/** Pure — every reason the download flow can't proceed at all, acquire or merge. */
export const environmentBlockReasons = (env: DownloadEnvironment): string[] => {
  return [...new Set([...acquireBlockReasons(env), ...mergeBlockReasons(env)])]
}

export const assertDownloadEnvironmentOk = async (): Promise<void> => {
  const reasons = environmentBlockReasons(await checkDownloadEnvironment())
  if (reasons.length) {
    throw createError({ statusCode: 503, message: `Can't manage downloads here: ${reasons.join('; ')}` })
  }
}
