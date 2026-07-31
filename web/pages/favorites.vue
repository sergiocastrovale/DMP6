<script setup lang="ts">
import { LucideHeart, LucideDisc, Loader2 } from 'lucide-vue-next'

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
    <PageTitle :icon="LucideHeart" text="Favorites" subtext="Your favorite releases and tracks" />

    <Tabs v-model="activeTab" :tabs="favTabs" />

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>

    <div v-else>
      <div v-if="activeTab === 'releases'">
        <div
          v-if="releases.length > 0"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
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
                class="absolute right-2 top-2 z-10 rounded-full bg-bg-1/90 p-1.5 text-accent opacity-0 transition-opacity group-hover:opacity-100"
                @click.stop="unfavoriteRelease(fav.release.id)"
              >
                <LucideHeart class="size-4" fill="currentColor" />
              </button>
            </template>
          </Block>
        </div>
        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
          <LucideDisc class="mb-3 size-12 opacity-50" />
          <p>No favorite releases yet</p>
          <UiButton variant="secondary" size="sm" to="/browse" class="mt-4">
            Browse releases
          </UiButton>
        </div>
      </div>
      <FavoritesTrackTable
        v-if="activeTab === 'tracks'"
        :tracks="tracks"
        @unfavorite="unfavoriteTrack"
      />

      <InfiniteScroll @load="loadMore" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <Loader2 :size="20" class="animate-spin text-ink0" />
      </div>
    </div>
  </div>
</template>
