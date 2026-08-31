<script setup lang="ts">
import { LucideHeart, LucideDisc, Loader2 } from 'lucide-vue-next'
import { grid } from '~/helpers/ui'

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

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-stone-100/55" />
    </div>

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
              <button
                class="absolute right-2 top-2 z-10 rounded-full bg-stone-900/90 p-1.5 text-amber-400 transition-colors duration-150 hover:text-amber-300"
                :aria-label="`Remove ${fav.release.title} from favorites`"
                @click.stop="unfavoriteRelease(fav.release.id)"
              >
                <LucideHeart class="size-4" fill="currentColor" />
              </button>
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
          <button
            class="rounded-full p-1.5 text-amber-400 transition-colors duration-150 hover:text-amber-300"
            :aria-label="`Remove ${row.track.title} from favorites`"
            @click.stop="unfavoriteTrack(row.track.id)"
          >
            <LucideHeart class="size-4" fill="currentColor" />
          </button>
        </template>
      </TrackTable>

      <InfiniteScroll @load="loadMore" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <Loader2 :size="20" class="animate-spin text-stone-100/55" />
      </div>
    </div>
  </div>
</template>
