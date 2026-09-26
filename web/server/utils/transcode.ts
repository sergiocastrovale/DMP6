import { errorMessage } from '~/helpers/functions'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, rename, unlink } from 'node:fs/promises'
import { join, dirname, extname, basename } from 'node:path'
import type { AudioTags } from '~/types/track'
import { monitorLog } from '~/server/utils/monitorLog'
import { sanitizePathSegment } from '~/server/utils/paths'

const execFileAsync = promisify(execFile)

// Lossless/other formats we re-encode to MP3-320. MP3 is left untouched.
const CONVERT_EXTENSIONS = new Set(['flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'ape', 'alac', 'wma'])

// Every extension layout.ts should treat as a track rather than a non-audio "extra" - mp3 plus
// everything transcodeDirToMp3320 *would* convert, since FLAC_TO_MP3=off leaves those formats
// passed through untouched instead of converted.
export const TRACK_EXTENSIONS = new Set(['mp3', ...CONVERT_EXTENSIONS])

export const ext = (name: string): string => {
  return extname(name).slice(1).toLowerCase()
}

export const sanitize = sanitizePathSegment

/**
 * Normalize every audio file in `dir` (recursively) to MP3 CBR `bitrate` (default 320,
 * Settings.flacToMp3Bitrate/FLAC_TO_MP3_BITRATE), then rename each resulting mp3 to
 * `NN. Track Title.mp3` based on its track-number/title tags.
 * - existing .mp3 files are kept as-is (but still renamed from tags)
 * - other audio formats are re-encoded (tags + embedded cover preserved) and the source removed
 * Returns the number of files converted. ffmpeg/ffprobe must be on PATH.
 * `signal` cancels the run: the in-flight ffmpeg is killed and the function throws instead of carrying on with
 * the remaining files (the monitor loop's deadline uses this so a timed-out relocate really stops).
 */
export const transcodeDirToMp3320 = async (dir: string, bitrate = 320, signal?: AbortSignal): Promise<{ converted: number; failed: number }> => {
  const log = (msg: string) => monitorLog('notice', `transcode: ${msg}`)
  const warn = (msg: string) => monitorLog('warn', `transcode: ${msg}`)
  let converted = 0
  let failed = 0

  const files = await collectAudioFiles(dir)
  const toConvert = files.filter(f => CONVERT_EXTENSIONS.has(ext(f)))

  // Fast, single pre-flight instead of N identical per-file failures: if ffmpeg is missing, every
  // convertible file is unusable in its current codec (the library layout only recognizes .mp3 —
  // see layout.ts). Fail the whole batch loudly rather than silently leaving lossless files behind
  // as unrecognized "extras".
  if (toConvert.length > 0 && !(await ffmpegAvailable())) {
    warn(`ffmpeg not found on PATH — ${toConvert.length} file(s) left un-transcoded in ${dir}`)
    return { converted: 0, failed: toConvert.length }
  }

  for (const src of toConvert) {
    signal?.throwIfAborted()
    const out = src.replace(/\.[^.]+$/, '.mp3')
    const part = `${out}.part`
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', src,
        '-map', '0:a',
        '-map', '0:v?', // embedded cover art if present
        '-c:v', 'copy',
        '-map_metadata', '0',
        '-id3v2_version', '3',
        '-c:a', 'libmp3lame',
        '-b:a', `${bitrate}k`,
        '-f', 'mp3', // required: muxer can't be inferred from the .part extension
        part,
      ], { maxBuffer: 1024 * 1024 * 16, signal })
      await rename(part, out)
      // remove the source (unless it shared the .mp3 name, which can't happen here)
      if (src !== out) {await unlink(src).catch(e => warn(`could not delete source ${basename(src)}: ${e.message}`))}
      converted++
    }
    catch (e) {
      await unlink(part).catch(() => {})
      if (signal?.aborted) {throw e}
      failed++
      await unlink(part).catch(() => {})
      warn(`failed ${basename(src)}: ${errorMessage(e).split('\n')[0]}`)
    }
  }

  // Rename every mp3 to `NN. Track Title.mp3` from its tags.
  const mp3s = (await collectAudioFiles(dir)).filter(f => ext(f) === 'mp3')
  for (const file of mp3s) {
    signal?.throwIfAborted()
    await renameFromTags(file).catch(e => warn(`rename failed ${basename(file)}: ${e.message || e}`))
  }

  if (converted || failed) {log(`${dir}: converted ${converted}, failed ${failed}`)}
  return { converted, failed }
}

/** Read track/disc/title/year tags via ffprobe (checks both format and stream tags). */
export const probeTags = async (file: string, signal?: AbortSignal): Promise<AudioTags> => {
  const keys = 'track,tracknumber,title,disc,discnumber,disctotal,totaldiscs,date,year,originalyear,originaldate'
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', `format_tags=${keys}:stream_tags=${keys}`,
    '-of', 'json',
    file,
  ], { maxBuffer: 1024 * 1024, signal })
  const parsed = JSON.parse(stdout || '{}')
  const sources = [parsed.format?.tags, ...(parsed.streams ?? []).map((s: any) => s.tags)].filter(Boolean)
  const pick = (...keys: string[]) => {
    for (const src of sources) {
      for (const k of keys) {
        const found = Object.entries(src).find(([key]) => key.toLowerCase() === k)
        if (found && String(found[1]).trim()) {return String(found[1]).trim()}
      }
    }
    return undefined
  }
  const yearRaw = pick('date', 'year', 'originalyear', 'originaldate')
  return {
    track: pick('track', 'tracknumber'),
    title: pick('title'),
    disc: pick('disc', 'discnumber'),
    discTotal: pick('disctotal', 'totaldiscs'),
    year: yearRaw?.match(/\d{4}/)?.[0], // first 4-digit year from "2007" / "2007-11-20" / etc.
  }
}

/**
 * Builds the `NN. Title.mp3` target filename from tags, prefixing the disc number
 * (`D-NN. Title.mp3`) whenever discTotal > 1 - a multi-disc release flattened into one directory
 * would otherwise have Disc 1 Track 1 and Disc 2 Track 1 collide on the same `01. Title.mp3` name,
 * silently leaving the second file un-renamed (audit #83).
 * Returns null when there's no usable track number/title.
 */
export const buildTrackFilename = (tags: AudioTags): string | null => {
  const { track, title, disc, discTotal } = tags
  if (!track || !title) {return null}

  const num = Number.parseInt(track, 10) // handles "1" and "1/12"
  if (!Number.isFinite(num)) {return null}

  const totalDiscs = discTotal ? Number.parseInt(discTotal, 10) : NaN
  const discNum = disc ? Number.parseInt(disc, 10) : NaN
  const numberPart = totalDiscs > 1 && Number.isFinite(discNum)
    ? `${discNum}-${String(num).padStart(2, '0')}`
    : String(num).padStart(2, '0')

  return `${numberPart}. ${sanitize(title)}.mp3`
}

/** Rename a single mp3 to `NN. Title.mp3` (or `D-NN. Title.mp3` for multi-disc); no-op when tags are missing or the target exists. */
const renameFromTags = async (file: string): Promise<void> => {
  const tags = await probeTags(file)
  const name = buildTrackFilename(tags)
  if (!name) {return}

  const dest = join(dirname(file), name)
  if (dest === file) {return}
  // Don't clobber an existing file.
  if (await access(dest).then(() => true, () => false)) {return}
  await rename(file, dest)
}

export const collectAudioFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > 6) {return []}
  let entries: { name: string; isDir: boolean }[]
  try {
    const raw = await readdir(dir, { withFileTypes: true })
    entries = raw.map(e => ({ name: e.name, isDir: e.isDirectory() }))
  }
  catch { return [] }

  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDir) {out.push(...await collectAudioFiles(full, depth + 1))}
    else {out.push(full)}
  }
  return out
}

/** Whether ffmpeg is available on PATH. */
export const ffmpegAvailable = async (): Promise<boolean> => {
  try {
    await execFileAsync('ffmpeg', ['-version'])
    return true
  }
  catch {
    return false
  }
}
