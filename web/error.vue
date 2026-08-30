<script setup lang="ts">
import { LucideAlertCircle, LucideHome } from 'lucide-vue-next'
import { button, ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  error: {
    statusCode: number
    statusMessage?: string
    message?: string
  }
}>()

const title = computed(() => {
  switch (props.error.statusCode) {
    case 404:
      return 'Page Not Found'
    case 500:
      return 'Server Error'
    default:
      return `Error ${props.error.statusCode}`
  }
})

const description = computed(() => {
  switch (props.error.statusCode) {
    case 404:
      return 'The page you\'re looking for doesn\'t exist or has been moved.'
    case 500:
      return 'Something went wrong on our end. Please try again later.'
    default:
      return props.error.statusMessage || props.error.message || 'An unexpected error occurred.'
  }
})

function handleError() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-stone-950 px-4">
    <div class="flex max-w-md flex-col items-center text-center">
      <div class="mb-6 flex size-20 items-center justify-center rounded-full bg-stone-900">
        <LucideAlertCircle class="size-10 text-amber-400" :stroke-width="ICON_STROKE_WIDTH" />
      </div>

      <h1 class="mb-2 font-display text-4xl font-bold text-stone-100">
        {{ error.statusCode }}
      </h1>
      <h2 class="mb-4 text-xl font-semibold text-stone-100/60">
        {{ title }}
      </h2>
      <p class="mb-8 text-sm text-stone-100/40">
        {{ description }}
      </p>

      <button type="button" :class="button('primary', 'lg')" @click="handleError">
        <LucideHome class="size-4" :stroke-width="ICON_STROKE_WIDTH" />
        Back to Home
      </button>
    </div>
  </div>
</template>
