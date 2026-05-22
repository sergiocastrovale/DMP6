<script setup lang="ts">
import type { Release } from '~/types/release'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

const loading = ref(true)
const viewMode = ref<'grid' | 'list'>('grid')

type Section =
  | { title: string, type: 'release', items: Ref<Release[]> }
  | { title: string, type: 'playlist', items: Ref<PlaylistSummary[]> }

const sections: Section[] = [
  { title: 'Latest Additions', type: 'release', items: ref([]) },
  { title: 'Recently Played', type: 'release', items: ref([]) },
  { title: 'Your Playlists', type: 'playlist', items: ref([]) },
  { title: 'Favorite Releases', type: 'release', items: ref([]) },
  { title: 'From the Archive', type: 'release', items: ref([]) },
]

const isEmpty = computed(() =>
  !loading.value && sections.every((s) => !s.items.value.length),
)

const endpoints = [
  `/api/releases/latest?limit=${SKELETON_GRID_SIZE}`,
  `/api/releases/last-played?limit=${SKELETON_GRID_SIZE}`,
  `/api/playlists?type=manual&limit=${SKELETON_GRID_SIZE}`,
  `/api/favorites/releases?limit=${SKELETON_GRID_SIZE}`,
  `/api/releases/archive?limit=${SKELETON_GRID_SIZE}`,
]

const loadData = async () => {
  loading.value = true

  try {
    const results = await Promise.all(endpoints.map((url) => $fetch(url)))
    sections.forEach((s, i) => { s.items.value = results[i] as any })
  }
  catch (error) {
    console.error('Failed to load home page data:', error)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="flex flex-col gap-10">
    <FirstScan v-if="isEmpty" />
    <template v-else>
      <DashboardSubheader v-model="viewMode" />

      <div class="flex flex-col gap-5">
        <DashboardSection
          v-for="section in sections"
          v-show="loading || section.items.value.length"
          :key="section.title"
          :title="section.title"
          :loading="loading"
          :empty="!section.items.value.length"
          :view-mode="viewMode"
        >
          <template v-if="section.type === 'playlist'">
            <template v-for="item in (section.items.value as PlaylistSummary[])" :key="item.id">
              <DashboardPlaylistCard v-if="viewMode === 'grid'" :playlist="item" />
              <DashboardPlaylistListRow v-else :playlist="item" />
            </template>
          </template>
          <template v-else>
            <template v-for="item in (section.items.value as Release[])" :key="item.id">
              <DashboardCard v-if="viewMode === 'grid'" :release="item" />
              <DashboardListRow v-else :release="item" />
            </template>
          </template>
        </DashboardSection>
      </div>
    </template>
  </div>
</template>
