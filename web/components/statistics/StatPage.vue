<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type { DataTableColumn } from '~/components/DataTable.vue'
import type { SortDir } from '~/helpers/functions'
import { typography } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  title: string
  apiType: string
  label: string
  columns: DataTableColumn[]
  defaultSort?: string
  defaultOrder?: SortDir
}>(), {
  defaultSort: '',
  defaultOrder: 'asc',
})

const slots = defineSlots<{
  [key: `cell-${string}`]: (props: { row: Record<string, any>, value: unknown }) => any
  actions?: (props: { row: Record<string, any> }) => any
}>()

// Only the cell-* slots are forwarded by name; `actions` is forwarded explicitly below, and
// including it here would make DataTable render an empty Actions column on every stat page.
const cellSlotNames = computed(() => Object.keys(slots).filter(name => name.startsWith('cell-')) as Array<`cell-${string}`>)
const hasActions = computed(() => !!slots.actions)

const items = ref<Record<string, any>[]>([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const searchQuery = ref('')
const sort = ref<{ key: string | null, dir: SortDir }>({ key: props.defaultSort || null, dir: props.defaultOrder })

const handleSearch = (value: string) => {
  searchQuery.value = value
  page.value = 1
  items.value = []
  fetchItems()
}

const handleSort = (key: string) => {
  sort.value = sort.value.key === key
    ? { key, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' }
  page.value = 1
  items.value = []
  fetchItems()
}

const fetchItems = async (append = false) => {
  if (!append) { loading.value = true }
  else { loadingMore.value = true }

  try {
    const data = await $fetch<{ items: Record<string, any>[], total: number, hasMore: boolean }>(`/api/stats/${props.apiType}`, {
      query: {
        page: page.value,
        pageSize: 200,
        search: searchQuery.value || undefined,
        sort: sort.value.key || undefined,
        order: sort.value.dir,
      },
    })
    items.value = append ? [...items.value, ...data.items] : data.items
    total.value = data.total
    hasMore.value = data.hasMore
  }
  catch {
    if (!append) { items.value = [] }
  }
  finally {
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
        <NuxtLink to="/statistics" aria-label="Back to statistics" class="text-stone-100/55 transition-colors duration-150 hover:text-stone-100">
          <ArrowLeft :size="20" />
        </NuxtLink>
        <h1 :class="typography.h2">{{ title }}</h1>
      </div>
      <span class="text-sm text-stone-100/55 tabular-nums">{{ total.toLocaleString() }} {{ label }}</span>
    </div>

    <div class="flex items-center gap-3">
      <SearchInput
        :model-value="searchQuery"
        :placeholder="`Search ${label}...`"
        :debounce="300"
        wrapper-class="sm:max-w-xs"
        @update:model-value="handleSearch"
      />
      <span v-if="!loading && items.length > 0 && items.length < total" class="text-xs text-stone-100/50">
        Showing {{ items.length.toLocaleString() }} of {{ total.toLocaleString() }}
      </span>
    </div>

    <DataTable
      :columns="columns"
      :rows="items"
      :selectable="false"
      :loading="loading"
      :sort="sort"
      :empty-message="`No ${label} found`"
      @sort="handleSort"
    >
      <template v-for="slotName in cellSlotNames" :key="slotName" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps" />
      </template>

      <template v-if="hasActions" #actions="slotProps">
        <slot name="actions" v-bind="slotProps" />
      </template>
    </DataTable>

    <InfiniteScroll @load="loadMore" />
    <UiLoadingBlock v-if="loadingMore" size="inline" />
  </div>
</template>
