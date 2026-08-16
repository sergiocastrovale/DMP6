<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { AlertTriangle } from 'lucide-vue-next'

const store = useDownloadsStore()
const { songkong } = storeToRefs(store)

const waited = computed(() => {
  const min = songkong.value?.oldestSpoolMin ?? 0
  if (min < 60) {
    return `${Math.round(min)} min`
  }
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
})
</script>

<template>
  <div
    v-if="songkong?.stalled"
    class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"
  >
    <AlertTriangle :size="15" class="mt-0.5 shrink-0" />
    <span>
      SongKong enrichment is not draining — {{ songkong.spoolCount }} album{{ songkong.spoolCount === 1 ? '' : 's' }}
      queued, oldest waiting {{ waited }}. Enrichment runs outside dmp, on a host cron
      (<code class="rounded bg-black/30 px-1">scripts/monitor/songkong-drain.sh</code>, every 2 min) — check that the
      cron job is enabled on the NAS and that the SongKong container is up. Downloads are not lost: each one
      merges without enrichment after {{ songkong.maxWaitMin }} min.
    </span>
  </div>
</template>
