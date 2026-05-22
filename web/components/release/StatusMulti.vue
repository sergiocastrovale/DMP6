<script setup lang="ts">
import type { UnifiedRelease, ReleaseStatus } from '~/types/release'
import { statuses } from '~/helpers/constants'

const props = defineProps<{
  releases: UnifiedRelease[]
}>()

const worstStatus = computed<ReleaseStatus>(() => {
  let worst = props.releases[0]?.status ?? 'UNKNOWN'
  let worstWeight = statuses.find(s => s.value === worst)?.weight ?? 99
  for (const r of props.releases) {
    const w = statuses.find(s => s.value === r.status)?.weight ?? 99
    if (w > worstWeight) {
      worstWeight = w
      worst = r.status
    }
  }
  return worst as ReleaseStatus
})

const editionTitle = (r: UnifiedRelease) => r.disambiguation || r.editionLabel || 'Original release'
const statusDesc = (s: string) => statuses.find(x => x.value === s)?.description ?? ''
</script>

<template>
  <Popover trigger="hover">
    <template #trigger>
      <ReleaseStatusBadge :status="worstStatus" />
    </template>
    <template #content>
      <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
        <template v-if="releases.length === 1">
          <p class="text-xs text-ink-2">{{ releases[0]!.statusReason || statusDesc(worstStatus) }}</p>
        </template>
        <template v-else>
          <div class="flex flex-col gap-2">
            <div
              v-for="r in releases"
              :key="r.id"
              class="flex items-center justify-between gap-2"
            >
              <span class="truncate text-xs text-ink-2">{{ editionTitle(r) }}</span>
              <ReleaseStatusBadge :status="r.status" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </Popover>
</template>
