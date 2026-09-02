<script setup lang="ts">
import { LucideDisc } from 'lucide-vue-next'
import { grid } from '~/helpers/ui'

useTitle('Favorites')

const { releaseImage } = useImageUrl()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')

const {
  loading, loadingMore, releases, tracks, activeTab, favTabs,
  loadMore, unfavoriteRelease, unfavoriteTrack,
} = useFavoritesPage()
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageTitle text="Favorites" subtext="Your favorite releases and tracks" />

    <Tabs v-model="activeTab" :tabs="favTabs" />

    <UiLoadingBlock v-if="loading" />

    <div v-else>
      <div v-if="activeTab === 'releases'">
        <div v-if="releases.length > 0" :class="grid.auto">
          <Block
            v-for="fav in releases"
            :id="fav.release.id"
            :key="fav.id"
            :title="fav.release.title"
            :title-link="`/artist/${fav.release.artist!.slug}?releaseId=${fav.release.id}`"
            :subtitle="fav.release.artist!.name"
            :subtitle-link="`/artist/${fav.release.artist!.slug}`"
            :year="fav.release.year"
            :image="releaseImage(fav.release)"
            playable
            :release-id="fav.release.id"
            :artist-slug="fav.release.artist!.slug"
          >
            <template v-if="canCrud" #overlay>
              <ToggleFavorite
                active
                :size="16"
                :label="`Remove ${fav.release.title} from favorites`"
                class="absolute right-2 top-2 z-10"
                @toggle="unfavoriteRelease(fav.release.id)"
              />
            </template>
          </Block>
        </div>
        <UiEmptyState v-else message="No favorite releases yet">
          <template #action>
            <UiButton variant="secondary" size="sm" to="/browse">
              Browse releases
            </UiButton>
          </template>
        </UiEmptyState>
      </div>

      <TrackTable
        v-if="activeTab === 'tracks'"
        :rows="tracks"
        empty-message="No favorite tracks yet"
      >
        <template v-if="canCrud" #action="{ row }">
          <ToggleFavorite
            active
            :size="16"
            :label="`Remove ${row.track.title} from favorites`"
            @toggle="unfavoriteTrack(row.track.id)"
          />
        </template>
      </TrackTable>

      <InfiniteScroll @load="loadMore" />
      <UiLoadingBlock v-if="loadingMore" size="inline" />
    </div>
  </div>
</template>
