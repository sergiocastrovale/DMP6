<script setup lang="ts">
import { ArrowDownWideNarrow, ArrowUpNarrowWide, X } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import { browseSortOptions, completenessRanges } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, sw, transitions, typography } from '~/helpers/ui'

const store = useBrowseStore()

const modelValue = defineModel<boolean>({ required: true })

const close = () => { modelValue.value = false }

const panelRef = ref<HTMLElement>()
useModalLayer(modelValue, panelRef, close)

const directionLabel = computed(() => (store.sortDir === 'asc' ? 'Asc' : 'Desc'))

const selectCompleteness = (range: typeof completenessRanges[number]) => {
  const isActive = store.minCompleteness === range.min && store.maxCompleteness === range.max
  store.setCompletenessRange(isActive ? null : range.min, isActive ? null : range.max)
}
</script>

<template>
  <Teleport to="body">
    <Transition v-bind="transitions.fade">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center bg-black/62 p-6 backdrop-blur-[3px] lg:block lg:p-0" @click.self="close">
        <Transition v-bind="transitions.drawer">
          <div
            v-if="modelValue"
            ref="panelRef"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            tabindex="-1"
            class="relative flex h-[90vh] max-h-[90vh] w-[90vw] flex-col rounded-xl border border-stone-100/10 bg-stone-900 shadow-xl outline-none lg:fixed lg:inset-y-0 lg:right-0 lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l"
          >
            <div class="flex items-center justify-between gap-3 border-b border-stone-100/10 px-5 py-4">
              <div class="flex items-center gap-2">
                <h2 class="text-xl font-semibold text-stone-200">Filters</h2>
                <UiSpinner v-if="store.loading" :size="14" />
              </div>
              <div class="flex items-center gap-4">
                <button
                  v-if="store.activeFilterCount"
                  type="button"
                  class="text-sm font-medium text-amber-400 hover:text-amber-300"
                  @click="store.clearFilters"
                >
                  Clear all
                </button>
                <button type="button" aria-label="Close" class="cursor-pointer text-stone-100/55 hover:text-stone-100" @click="close">
                  <X :size="20" :stroke-width="ICON_STROKE_WIDTH" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
              <section class="flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <h3 :class="typography.sectionLabel">Sort by</h3>
                  <UiButton
                    variant="quiet"
                    size="sm"
                    :icon="store.sortDir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow"
                    @click="store.toggleSortDir"
                  >
                    {{ directionLabel }}
                  </UiButton>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="option in browseSortOptions"
                    :key="option.value"
                    type="button"
                    :class="cx(sw('chip', store.sortBy === option.value), 'justify-center')"
                    @click="store.setSortBy(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </section>

              <hr class="my-5 border-stone-100/6">

              <section class="flex flex-col gap-3">
                <h3 :class="typography.sectionLabel">Genre</h3>
                <BrowseFiltersGenre />
              </section>

              <hr class="my-5 border-stone-100/6">

              <section class="flex flex-col gap-3">
                <h3 :class="typography.sectionLabel">Completeness</h3>
                <div class="flex flex-col gap-1">
                  <button
                    v-for="range in completenessRanges"
                    :key="range.label"
                    type="button"
                    :aria-pressed="store.minCompleteness === range.min && store.maxCompleteness === range.max"
                    :class="cx(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-stone-800',
                      store.minCompleteness === range.min && store.maxCompleteness === range.max
                        ? cx('bg-stone-800 font-medium', range.textColor)
                        : 'text-stone-100/60',
                    )"
                    @click="selectCompleteness(range)"
                  >
                    <span class="size-2.5 shrink-0 rounded-full" :class="range.color" />
                    {{ range.label }}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
