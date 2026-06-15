import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'

/**
 * SongKong enrichment runs OUTSIDE the dmp container (no docker socket): the dmp container can't
 * invoke the dedicated SongKong instance, so it drops a spool file into a shared directory under
 * DOWNLOADS_PATH and a host cron drainer (dmp-songkong-drain.sh) runs SongKong, then writes a
 * `done/<id>` marker the reconcile loop polls for. All paths here are the dmp container's view.
 */
export const SONGKONG_DIR_NAME = '.dmp-songkong'

/**
 * Spool/done dir lives at the downloads VOLUME root (not under DOWNLOADS_PATH), so it stays put when
 * the download subfolder changes and matches the host cron scripts' fixed path. Override with
 * SONGKONG_STATE_DIR; defaults to /mnt/SSD/Downloads/.dmp-songkong (identity-mounted = same in-container).
 */
export const songkongDirs = () => {
  const root = process.env.SONGKONG_STATE_DIR || `/mnt/SSD/Downloads/${SONGKONG_DIR_NAME}`
  return { root, spool: join(root, 'spool'), done: join(root, 'done') }
}

/** Whether downloads should be enriched with SongKong (DB wins, then env, default off). */
export const resolveSongkongEnabled = async (): Promise<boolean> => {
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  if (typeof settings?.songkongEnabled === 'boolean') {
    return settings.songkongEnabled
  }
  return process.env.SONGKONG_ENABLED === 'true' || process.env.SONGKONG_ENABLED === '1'
}

/** Hard ceiling on how long a row may sit in ENRICHING before the reconciler gives up (minutes). */
export const songkongMaxWaitMin = (): number => {
  const env = Number(process.env.SONGKONG_MAX_WAIT_MIN)
  return Number.isFinite(env) && env > 0 ? env : 30
}
