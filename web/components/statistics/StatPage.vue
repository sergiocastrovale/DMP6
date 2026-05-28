<script setup lang="ts">
import { Search, ArrowLeft, Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-vue-next'

interface StatColumn {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right'
  class?: string
}

const props = withDefaults(defineProps<{
  title: string
  apiType: string
  label: string
  columns: StatColumn[]
  defaultSort?: string
  defaultOrder?: 'asc' | 'desc'
}>(), {
  defaultSort: '',
  defaultOrder: 'asc',
})

const items = ref<Record<string, any>[]>([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const searchInput = ref('')
const searchQuery = ref('')
const sortKey = ref(props.defaultSort)
const sortOrder = ref<'asc' | 'desc'>(props.defaultOrder)

let searchTimeout: ReturnType<typeof setTimeout>

const handleSearch = (value: string) => {
  searchInput.value = value
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    searchQuery.value = value
    page.value = 1
    items.value = []
    fetchItems()
  }, 300)
}

const toggleSort = (col: StatColumn) => {
  if (!col.sortable) { return }
  if (sortKey.value === col.key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = col.key
    sortOrder.value = 'asc'
  }
  page.value = 1
  items.value = []
  fetchItems()
}

const fetchItems = async (append = false) => {
  if (!append) { loading.value = true }
  else { loadingMore.value = true }

  try {
    const data = await $fetch<{ items: Record<string, any>[]; total: number; hasMore: boolean }>(`/api/stats/${props.apiType}`, {
      query: {
        page: page.value,
        pageSize: 200,
        search: searchQuery.value || undefined,
        sort: sortKey.value || undefined,
        order: sortOrder.value,
      },
    })
    items.value = append ? [...items.value, ...data.items] : data.items
    total.value = data.total
    hasMore.value = data.hasMore
  } catch {
    if (!append) { items.value = [] }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

const loadMore = () => {
  if (!loadingMore.value && hasMore.value) {
    page.value++
    fetchItems(true)
  }
}

onMounted(() => {
  fetchItems()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <NuxtLink to="/statistics" class="text-ink-2 hover:text-ink transition-colors">
          <ArrowLeft :size="20" />
        </NuxtLink>
        <h1 class="text-2xl font-bold text-ink">{{ title }}</h1>
      </div>
      <span class="text-sm text-ink0">{{ total.toLocaleString() }} {{ label }}</span>
    </div>

    <div class="relative sm:max-w-xs">
      <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink0" />
      <input
        :value="searchInput"
        type="text"
        :placeholder="`Search ${label}...`"
        class="h-8 w-full rounded-lg border border-rule bg-bg-1 pl-8 pr-3 text-sm text-ink placeholder:text-ink0 focus:border-accent focus:outline-none"
        @input="handleSearch(($event.target as HTMLInputElement).value)"
      />
    </div>

    <div v-if="!loading && items.length > 0 && items.length < total" class="text-xs text-ink0">
      Showing {{ items.length.toLocaleString() }} of {{ total.toLocaleString() }}
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>

    <div v-else-if="items.length === 0" class="py-20 text-center text-ink0">
      No results found
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-rule">
      <table class="w-full">
        <thead>
          <tr class="border-b border-rule bg-bg-1">
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink0"
              :class="[
                col.align === 'right' ? 'text-right' : 'text-left',
                col.sortable ? 'cursor-pointer select-none hover:text-ink transition-colors' : '',
                col.class,
              ]"
              @click="toggleSort(col)"
            >
              <span class="inline-flex items-center gap-1">
                {{ col.label }}
                <template v-if="col.sortable">
                  <ArrowUp v-if="sortKey === col.key && sortOrder === 'asc'" :size="12" />
                  <ArrowDown v-else-if="sortKey === col.key && sortOrder === 'desc'" :size="12" />
                  <ArrowUpDown v-else :size="12" class="opacity-30" />
                </template>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            class="border-b border-rule/50 last:border-b-0 transition-colors hover:bg-bg-1"
          >
            <slot name="row" :item="item" />
          </tr>
        </tbody>
      </table>
    </div>

    <InfiniteScroll @load="loadMore" />

    <div v-if="loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" class="animate-spin text-ink0" />
    </div>
  </div>
</template>
