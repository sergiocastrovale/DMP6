<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import { artistReleaseSortOptions, releaseTypeOptions, statuses } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, sw, toneFill } from '~/helpers/ui'

const props = defineProps<{
  statusCounts: Record<string, number>
}>()

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!
const { hideMissing, showLinked, favoritesOnly, typeFilters, activeStatuses, sortKey, hasLinkedReleases, activeFilterCount, clearFilters } = catalogue

const modelValue = defineModel<boolean>({ required: true })

const visibleStatuses = computed(() => statuses.filter(s => (props.statusCounts[s.value] ?? 0) > 0))

const statusCountsText = (status: string) => {
  const count = props.statusCounts[status] ?? 0
  return `${count} ${count === 1 ? 'release' : 'releases'}`
}

const toggleType = (value: string) => {
  const next = new Set(typeFilters.value)
  next.has(value) ? next.delete(value) : next.add(value)
  typeFilters.value = next
}

const toggleStatus = (value: string) => {
  const next = new Set(activeStatuses.value)
  next.has(value) ? next.delete(value) : next.add(value)
  activeStatuses.value = next
}

const helpOpen = ref(false)
</script>

<template>
  <UiFiltersSidebar v-model="modelValue" :active-count="activeFilterCount" @clear="clearFilters">
    <UiFilterSection title="Sort by">
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="option in artistReleaseSortOptions"
          :key="option.value"
          type="button"
          :class="cx(sw('chip', sortKey === option.value), 'justify-center')"
          @click="sortKey = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </UiFilterSection>

    <hr class="my-5 border-stone-100/6">

    <UiFilterSection title="Release type">
      <div class="flex flex-col gap-2">
        <UiCheckbox
          v-for="option in releaseTypeOptions"
          :key="option.value"
          :model-value="typeFilters.has(option.value)"
          :label="option.label"
          @update:model-value="toggleType(option.value)"
        />
      </div>
    </UiFilterSection>

    <hr class="my-5 border-stone-100/6">

    <UiFilterSection title="Status">
      <template #title-extra>
        <button
          type="button"
          aria-label="Toggle status legend"
          class="text-stone-100/55 transition-colors duration-150 hover:text-stone-100/60"
          @click="helpOpen = !helpOpen"
        >
          <HelpCircle :size="14" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </template>
      <div class="flex flex-col gap-1">
        <button
          v-for="s in visibleStatuses"
          :key="s.value"
          type="button"
          :aria-pressed="activeStatuses.size === 0 || activeStatuses.has(s.value)"
          :class="cx(
            'flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-stone-800',
            (activeStatuses.size === 0 || activeStatuses.has(s.value))
              ? 'bg-stone-800 font-medium text-stone-100'
              : 'text-stone-100/60',
          )"
          @click="toggleStatus(s.value)"
        >
          <span class="flex items-center justify-between gap-2.5">
            <span class="flex items-center gap-2.5">
              <span class="size-1.5 shrink-0 rounded-full" :class="toneFill[s.tone]" />
              {{ s.label }}
            </span>
            <span class="text-stone-100/50">{{ statusCountsText(s.value) }}</span>
          </span>
          <span v-if="helpOpen" class="pl-5 text-xs font-normal text-stone-100/50">{{ s.description }}</span>
        </button>
      </div>
    </UiFilterSection>

    <hr class="my-5 border-stone-100/6">

    <UiFilterSection title="Visibility">
      <div class="flex flex-col gap-3">
        <Switch v-model="hideMissing" label="Hide missing" />
        <Switch v-if="hasLinkedReleases" v-model="showLinked" label="Show linked" />
        <Switch v-model="favoritesOnly" label="Favorites only" />
      </div>
    </UiFilterSection>
  </UiFiltersSidebar>
</template>
