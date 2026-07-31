import { mkdir, rename, unlink } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname } from 'node:path'

/**
 * Stream-copy one file. Deliberately NOT fs.copyFile: that uses the copy_file_range syscall, which
 * returns EPERM across distinct ZFS datasets on TrueNAS (e.g. staging on /mnt/SSD -> library on
 * /mnt/dmp) even though a streamed read/write copy across the same two paths works fine. Every place
 * that copies a single file across the staging/library/downloads volumes should go through this
 * instead of reintroducing fs.copyFile.
 */
export const streamCopyFile = async (src: string, dest: string): Promise<void> => {
  await pipeline(createReadStream(src), createWriteStream(dest))
}

/**
 * Move a single file: rename() when possible (same filesystem/fast path), falling back to a streamed
 * copy+unlink for cross-device or permission-restricted moves (see streamCopyFile above).
 */
export const safeMoveFile = async (src: string, dest: string): Promise<void> => {
  if (src === dest) {return}
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
    return
  }
  catch (e: any) {
    if (!['EXDEV', 'EACCES', 'EPERM'].includes(e?.code)) {throw e}
  }
  await streamCopyFile(src, dest)
  await unlink(src).catch(() => {})
}
