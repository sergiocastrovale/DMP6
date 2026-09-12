<script setup lang="ts">
import type { Component } from 'vue'

const props = defineProps<{
  type: 'artists' | 'releases' | 'tracks'
  query: string
  label: string
  emptyIcon?: Component
}>()

defineSlots<{ default: (props: { items: Record<string, any>[] }) => any }>()

const items = ref<Record<string, any>[]>([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)

// Aborts any in-flight fetch when a newer one starts (tab switch, query edit mid-request) so a
// slow stale response can never land after - and overwrite - a fresher one. Mirrors stores/browse.ts.
let abortController: AbortController | null = null

const fetchPage = async (append = false) => {
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller

  append ? (loadingMore.value = true) : (loading.value = true)

  try {
    const data = await $fetch<{ items: Record<string, any>[], total: number, hasMore: boolean }>(
      `/api/search/${props.type}`,
      { params: { q: props.query, page: append ? page.value : 1, pageSize: 48 }, signal: controller.signal },
    )
    if (controller.signal.aborted) {return}

    items.value = append ? [...items.value, ...data.items] : data.items
    total.value = data.total
    hasMore.value = data.hasMore
    if (!append) {page.value = 1}
  }
  catch (e: any) {
    if (e?.name !== 'AbortError') {throw e}
  }
  finally {
    if (abortController === controller) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

const loadMore = () => {
  if (!hasMore.value || loadingMore.value) {return}
  page.value++
  fetchPage(true)
}

watch(() => [props.type, props.query], () => fetchPage(), { immediate: true })
</script>

<template>
  <div>
    <UiLoadingBlock v-if="loading" />

    <UiEmptyState
      v-else-if="items.length === 0"
      :icon="emptyIcon"
      :message="`No ${label} found.`"
      hint="Try a different search term."
    />

    <template v-else>
      <slot :items="items" />

      <InfiniteScroll @load="loadMore" />

      <UiLoadingBlock v-if="loadingMore" size="inline" />

      <div class="mt-4 text-center text-xs text-stone-100/55">
        Showing {{ items.length }} of {{ total.toLocaleString() }} {{ label }}
      </div>
    </template>
  </div>
</template>
