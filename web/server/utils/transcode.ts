import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, rename, unlink } from 'node:fs/promises'
import { join, dirname, extname, basename } from 'node:path'
import { monitorLog } from '~/server/utils/monitorLog'

const execFileAsync = promisify(execFile)

// Lossless/other formats we re-encode to MP3-320. MP3 is left untouched.
const CONVERT_EXTENSIONS = new Set(['flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'ape', 'alac', 'wma'])

export function ext(name: string): string {
  return extname(name).slice(1).toLowerCase()
}

// Strip characters illegal in filenames; collapse whitespace (mirrors resolveDownloadDir).
export const sanitize = (s: string) => s
  .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200)

/**
 * Normalize every audio file in `dir` (recursively) to MP3 CBR 320, then rename each
 * resulting mp3 to `NN. Track Title.mp3` based on its track-number/title tags.
 * - existing .mp3 files are kept as-is (but still renamed from tags)
 * - other audio formats are re-encoded (tags + embedded cover preserved) and the source removed
 * Returns the number of files converted. ffmpeg/ffprobe must be on PATH.
 */
export async function transcodeDirToMp3320(dir: string): Promise<{ converted: number; failed: number }> {
  const log = (msg: string) => monitorLog('notice', `transcode: ${msg}`)
  const warn = (msg: string) => monitorLog('warn', `transcode: ${msg}`)
  let converted = 0
  let failed = 0

  const files = await collectAudioFiles(dir)
  for (const src of files) {
    if (!CONVERT_EXTENSIONS.has(ext(src))) continue // keep mp3 and non-audio
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
        '-b:a', '320k',
        '-f', 'mp3', // required: muxer can't be inferred from the .part extension
        part,
      ], { maxBuffer: 1024 * 1024 * 16 })
      await rename(part, out)
      // remove the source (unless it shared the .mp3 name, which can't happen here)
      if (src !== out) await unlink(src).catch(e => warn(`could not delete source ${basename(src)}: ${e.message}`))
      converted++
    }
    catch (e: any) {
      failed++
      await unlink(part).catch(() => {})
      warn(`failed ${basename(src)}: ${e.message?.split('\n')[0] || e}`)
    }
  }

  // Rename every mp3 to `NN. Track Title.mp3` from its tags.
  const mp3s = (await collectAudioFiles(dir)).filter(f => ext(f) === 'mp3')
  for (const file of mp3s) {
    await renameFromTags(file).catch(e => warn(`rename failed ${basename(file)}: ${e.message || e}`))
  }

  if (converted || failed) log(`${dir}: converted ${converted}, failed ${failed}`)
  return { converted, failed }
}

export interface AudioTags {
  track?: string
  title?: string
  disc?: string
  discTotal?: string
  year?: string
}

/** Read track/disc/title/year tags via ffprobe (checks both format and stream tags). */
export async function probeTags(file: string): Promise<AudioTags> {
  const keys = 'track,tracknumber,title,disc,discnumber,disctotal,totaldiscs,date,year,originalyear,originaldate'
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', `format_tags=${keys}:stream_tags=${keys}`,
    '-of', 'json',
    file,
  ], { maxBuffer: 1024 * 1024 })
  const parsed = JSON.parse(stdout || '{}')
  const sources = [parsed.format?.tags, ...(parsed.streams ?? []).map((s: any) => s.tags)].filter(Boolean)
  const pick = (...keys: string[]) => {
    for (const src of sources) {
      for (const k of keys) {
        const found = Object.entries(src).find(([key]) => key.toLowerCase() === k)
        if (found && String(found[1]).trim()) return String(found[1]).trim()
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

/** Rename a single mp3 to `NN. Title.mp3`; no-op when tags are missing or the target exists. */
async function renameFromTags(file: string): Promise<void> {
  const { track, title } = await probeTags(file)
  if (!track || !title) return

  const num = Number.parseInt(track, 10) // handles "1" and "1/12"
  if (!Number.isFinite(num)) return

  const name = `${String(num).padStart(2, '0')}. ${sanitize(title)}.mp3`
  const dest = join(dirname(file), name)
  if (dest === file) return
  // Don't clobber an existing file.
  if (await access(dest).then(() => true, () => false)) return
  await rename(file, dest)
}

export async function collectAudioFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  let entries: { name: string; isDir: boolean }[] = []
  try {
    const raw = await readdir(dir, { withFileTypes: true })
    entries = raw.map(e => ({ name: e.name, isDir: e.isDirectory() }))
  }
  catch { return [] }

  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDir) out.push(...await collectAudioFiles(full, depth + 1))
    else out.push(full)
  }
  return out
}

/** Whether ffmpeg is available on PATH. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'])
    return true
  }
  catch {
    return false
  }
}
