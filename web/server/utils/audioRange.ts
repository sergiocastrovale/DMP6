// Pure helpers for the audio streaming endpoint. Kept dependency-free (no h3/prisma) so the
// streaming contract - Range parsing, ETag, MIME - is unit-testable in isolation.
import type { ByteRange } from '~/types/track'

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
}

export const mimeForFile = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'mp3'
  return MIME_TYPES[ext] || 'audio/mpeg'
}

export const buildEtag = (size: number, mtimeMs: number): string => `"${size}-${mtimeMs}"`


// Parse an HTTP Range header against a known file size. Returns null when the header is absent or
// unsatisfiable, in which case the caller should serve the full 200 response.
export const parseRangeHeader = (rangeHeader: string | undefined, fileSize: number): ByteRange | null => {
  if (!rangeHeader || fileSize <= 0) {
    return null
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) {
    return null
  }
  const [, rawStart, rawEnd] = match
  const hasStart = rawStart !== ''
  const hasEnd = rawEnd !== ''
  if (!hasStart && !hasEnd) {
    return null
  }

  let start: number
  let end: number
  if (!hasStart) {
    // Suffix range: last N bytes.
    const suffix = parseInt(rawEnd!, 10)
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  }
  else {
    start = parseInt(rawStart!, 10)
    end = hasEnd ? parseInt(rawEnd!, 10) : fileSize - 1
  }

  end = Math.min(end, fileSize - 1)
  if (start > end || start < 0) {
    return null
  }
  return { start, end, chunkSize: end - start + 1 }
}

// `Content-Disposition: attachment` for a download. A raw `filename="${name}"` breaks two ways: Node refuses
// header values containing characters above U+00FF (any CJK/Cyrillic/Greek/emoji filename -> 500), and a
// `"` in the name ends the quoted string early. So: an ASCII-only fallback in `filename=` for old clients
// plus the real name percent-encoded in `filename*=UTF-8''...` (RFC 5987/6266), which modern clients prefer.
export const contentDispositionAttachment = (filename: string): string => {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'download'
  // encodeURIComponent leaves ' ( ) * unescaped; RFC 5987's attr-char set doesn't allow ' ( ) * so encode them too.
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
