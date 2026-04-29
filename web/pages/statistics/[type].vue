<script setup lang="ts">
import { Search, ArrowLeft, Loader2 } from 'lucide-vue-next'

definePageMeta({ layout: 'admin' })

interface StatItem {
  id: string
  name?: string
  slug?: string
  title?: string
  year?: number | null
  artistName?: string | null
  artistSlug?: string | null
  playCount?: number
  artistCount?: number
}

const CONFIGS: Record<string, { title: string; label: string }> = {
  'artists': { title: 'Artists', label: 'artists' },
  'releases': { title: 'Releases', label: 'releases' },
  'tracks': { title: 'Tracks', label: 'tracks' },
  'genres': { title: 'Genres', label: 'genres' },
  'plays': { title: 'Played Tracks', label: 'tracks' },
  'artists-synced': { title: 'Artists Synced', label: 'artists' },
  'releases-synced': { title: 'Releases Synced', label: 'releases' },
  'artists-with-art': { title: 'Artists with Photo', label: 'artists' },
  'releases-with-art': { title: 'Releases with Cover', label: 'releases' },
}

const route = useRoute()
const type = computed(() => route.params.type as string)
const config = computed(() => CONFIGS[type.value])

const items = ref<StatItem[]>([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const search = ref('')
const searchInput = ref('')

let searchTimeout: ReturnType<typeof setTimeout>

function handleSearch(value: string) {
  searchInput.value = value
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    search.value = value
    page.value = 1
    items.value = []
    fetchItems()
  }, 300)
}

async function fetchItems(append = false) {
  if (!append) loading.value = true
  else loadingMore.value = true

  try {
    const data = await $fetch<{ items: StatItem[]; total: number; hasMore: boolean }>(`/api/stats/${type.value}`, {
      query: { page: page.value, pageSize: 200, search: search.value || undefined },
    })
    if (append) {
      items.value.push(...data.items)
    }
    else {
      items.value = data.items
    }
    total.value = data.total
    hasMore.value = data.hasMore
  }
  catch {
    if (!append) items.value = []
  }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  page.value++
  fetchItems(true)
}

function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement
  const pct = (scrollTop + clientHeight) / scrollHeight
  if (pct > 0.75) {
    loadMore()
  }
}

// Artist-type items link to /artist/slug
const isArtistType = computed(() =>
  ['artists', 'artists-synced', 'artists-with-art'].includes(type.value),
)

onMounted(() => {
  if (!config.value) {
    navigateTo('/statistics')
    return
  }
  fetchItems()
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div v-if="config" class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <NuxtLink to="/statistics" class="text-zinc-400 hover:text-zinc-50 transition-colors">
          <ArrowLeft :size="20" />
        </NuxtLink>
        <h1 class="text-2xl font-bold text-zinc-50">{{ config.title }}</h1>
      </div>
      <span class="text-sm text-zinc-500">{{ total.toLocaleString() }} {{ config.label }}</span>
    </div>

    <!-- Search -->
    <div class="relative sm:max-w-xs">
      <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        :value="searchInput"
        type="text"
        :placeholder="`Search ${config.label}...`"
        class="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-8 pr-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        @input="handleSearch(($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- Showing X of Y -->
    <div v-if="!loading && items.length > 0 && items.length < total" class="text-xs text-zinc-500">
      Showing {{ items.length.toLocaleString() }} results of {{ total.toLocaleString() }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="py-20 text-center text-zinc-500">
      No results found
    </div>

    <!-- List -->
    <div v-else class="overflow-hidden rounded-lg border border-zinc-800">
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-2.5 last:border-b-0 transition-colors"
        :class="isArtistType ? '' : 'hover:bg-zinc-900'"
      >
        <!-- Artist-type rows: linked name -->
        <template v-if="isArtistType">
          <NuxtLink
            :to="`/artist/${item.slug}`"
            class="flex-1 truncate text-sm text-zinc-50 hover:text-amber-500 transition-colors"
          >
            {{ item.name }}
          </NuxtLink>
        </template>

        <!-- Release-type rows -->
        <template v-else-if="item.title !== undefined && item.artistName !== undefined && item.playCount === undefined">
          <NuxtLink
            v-if="item.artistSlug"
            :to="`/artist/${item.artistSlug}`"
            class="flex-1 truncate text-sm text-zinc-50 hover:text-amber-500 transition-colors"
          >
            {{ item.title }}
          </NuxtLink>
          <span v-else class="flex-1 truncate text-sm text-zinc-50">{{ item.title }}</span>
          <span v-if="item.artistName" class="hidden shrink-0 text-xs text-zinc-400 md:block">{{ item.artistName }}</span>
          <span v-if="item.year" class="shrink-0 text-xs tabular-nums text-zinc-500">{{ item.year }}</span>
        </template>

        <!-- Track-type rows (tracks, no play count) -->
        <template v-else-if="item.title !== undefined && item.playCount === undefined">
          <span class="flex-1 truncate text-sm text-zinc-50">{{ item.title }}</span>
          <span v-if="item.artistName" class="hidden shrink-0 text-xs text-zinc-400 md:block">{{ item.artistName }}</span>
        </template>

        <!-- Plays rows -->
        <template v-else-if="item.playCount !== undefined">
          <span class="flex-1 truncate text-sm text-zinc-50">{{ item.title }}</span>
          <span v-if="item.artistName" class="hidden shrink-0 text-xs text-zinc-400 md:block">{{ item.artistName }}</span>
          <span class="shrink-0 text-xs tabular-nums text-zinc-500">{{ item.playCount?.toLocaleString() }} plays</span>
        </template>

        <!-- Genre rows -->
        <template v-else-if="item.name !== undefined && item.artistCount !== undefined">
          <span class="flex-1 truncate text-sm text-zinc-50">{{ item.name }}</span>
          <span class="shrink-0 text-xs text-zinc-500">{{ item.artistCount }} artists</span>
        </template>
      </div>
    </div>

    <!-- Loading more -->
    <div v-if="loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" class="animate-spin text-zinc-500" />
    </div>
  </div>
</template>
