<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { ICON_STROKE_WIDTH, transitions } from '~/helpers/ui'

withDefaults(defineProps<{
  activeCount?: number
  title?: string
}>(), {
  activeCount: 0,
  title: 'Filters',
})

const emit = defineEmits<{
  clear: []
}>()

const modelValue = defineModel<boolean>({ required: true })

const close = () => { modelValue.value = false }

const panelRef = ref<HTMLElement>()
useModalLayer(modelValue, panelRef, close)
</script>

<template>
  <Teleport to="body">
    <Transition v-bind="transitions.fade">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center bg-black/62 p-6 lg:block lg:p-0" @click.self="close">
        <Transition v-bind="transitions.drawer">
          <div
            v-if="modelValue"
            ref="panelRef"
            role="dialog"
            aria-modal="true"
            :aria-label="title"
            tabindex="-1"
            class="relative flex h-[90vh] max-h-[90vh] w-[90vw] max-w-[320px] flex-col rounded-xl border border-stone-100/10 bg-stone-900 shadow-xl outline-none lg:fixed lg:inset-y-0 lg:right-0 lg:h-full lg:max-h-none lg:w-[320px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l"
          >
            <div class="flex items-center justify-between gap-3 border-b border-stone-100/10 px-5 py-4">
              <div class="flex items-center gap-2">
                <h2 class="text-xl font-semibold text-stone-200">{{ title }}</h2>
                <slot name="header-extra" />
              </div>
              <div class="flex items-center gap-4">
                <button
                  v-if="activeCount"
                  type="button"
                  class="text-sm font-medium text-amber-400 hover:text-amber-300"
                  @click="emit('clear')"
                >
                  Clear all
                </button>
                <button type="button" aria-label="Close" class="cursor-pointer text-stone-100/55 hover:text-stone-100" @click="close">
                  <X :size="20" :stroke-width="ICON_STROKE_WIDTH" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
              <slot />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
