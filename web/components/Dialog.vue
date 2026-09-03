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
useFocusTrap(panelRef, isOpen)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close()
  }
}

// Body scroll lock: a dialog over a scrollable page must not let the page behind it scroll too.
// onMounted (not an immediate watcher) for the initial state - this runs during Nuxt's SSR
// setup() too, where `document` doesn't exist; onMounted is guaranteed client-only.
const applyOpenEffects = (open: boolean) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  }
  else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
}

onMounted(() => {
  if (isOpen.value) {
    applyOpenEffects(true)
  }
})

watch(isOpen, applyOpenEffects)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (isOpen.value) {
    document.body.style.overflow = ''
  }
})
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
        <div :class="cx(layout.dialogActions)">
          <slot name="actions" />
        </div>

        <div :class="cx(layout.dialogContent)">
          <slot name="content" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
