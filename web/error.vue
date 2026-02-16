<script setup lang="ts">
import { LucideHome, LucideAlertCircle } from 'lucide-vue-next'

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
  <div class="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
    <div class="flex max-w-md flex-col items-center text-center">
      <div class="mb-6 flex size-20 items-center justify-center rounded-full bg-zinc-900">
        <LucideAlertCircle class="size-10 text-amber-500" />
      </div>

      <h1 class="mb-2 text-4xl font-bold text-zinc-50">
        {{ error.statusCode }}
      </h1>
      <h2 class="mb-4 text-xl font-semibold text-zinc-300">
        {{ title }}
      </h2>
      <p class="mb-8 text-sm text-zinc-500">
        {{ description }}
      </p>

      <button
        class="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
        @click="handleError"
      >
        <LucideHome class="size-4" />
        Back to Home
      </button>
    </div>
  </div>
</template>
