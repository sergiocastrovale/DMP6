<script setup lang="ts">
import type { Release } from '~/types/release'
import type { PlaylistSummary } from '~/types/playlist'
import type { DashboardSection } from '~/types/common'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

useTitle('Dashboard')

const { releaseImage } = useImageUrl()
const loading = ref(true)

const sections: DashboardSection[] = [
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
  <div class="flex flex-col gap-5 lg:gap-8">
    <DashboardFirstScan v-if="isEmpty" />
    <template v-else>
      <DashboardSubheader />

      <div class="flex flex-col gap-5">
        <DashboardSection
          v-for="section in sections"
          v-show="loading || section.items.value.length"
          :key="section.title"
          :title="section.title"
          :loading="loading"
          :empty="!section.items.value.length"
        >
          <template v-if="section.type === 'playlist'">
            <DashboardPlaylistCard
              v-for="item in (section.items.value as PlaylistSummary[])"
              :key="item.id"
              :playlist="item"
            />
          </template>
          <template v-else>
            <Block
              v-for="item in (section.items.value as Release[])"
              :id="item.id"
              :key="item.id"
              :title="item.title"
              :title-link="`/artist/${item.artist!.slug}?releaseId=${item.id}`"
              :subtitle="item.artist!.name"
              :subtitle-link="`/artist/${item.artist!.slug}`"
              :year="item.year"
              :genre="item.genre"
              :image="releaseImage(item)"
              playable
              :release-id="item.id"
              :artist-slug="item.artist!.slug"
            />
          </template>
        </DashboardSection>
      </div>
    </template>
  </div>
</template>
