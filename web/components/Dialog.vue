<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { cx, layout } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  subtitle?: string
}>(), {
  size: 'lg',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const close = () => emit('update:modelValue', false)

const MAX_WIDTH_CLASS: Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
}

const maxWidthClass = computed(() => MAX_WIDTH_CLASS[props.size])
const titleId = useId()
const isOpen = computed(() => props.modelValue)

const panelRef = ref<HTMLElement>()
useModalLayer(isOpen, panelRef, close)
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" :class="layout.scrim" @click.self="close">
      <div
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="titleId"
        :class="cx(layout.dialog, maxWidthClass)"
      >
        <div  :class="cx(layout.dialogTitle)">
          <div class="min-w-0">
            <h2 :id="titleId" class="text-xl font-semibold text-stone-200">{{ title }}</h2>
            <p v-if="subtitle" class="mt-1 text-sm text-stone-100/55">{{ subtitle }}</p>
          </div>
          <button type="button" aria-label="Close" @click="close" class="cursor-pointer">
            <X :size="20" class="" />
          </button>
        </div>
        <div v-if="$slots.actions" :class="cx(layout.dialogActions)">
          <slot name="actions" />
        </div>

        <div :class="cx(layout.dialogContent)">
          <slot name="content" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
