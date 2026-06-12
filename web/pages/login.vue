<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const { login } = useAuth()

const canSubmit = computed(() => !!username.value && !!password.value && !loading.value)

const handleSubmit = async () => {
  if (!canSubmit.value) return
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value)
  }
  catch {
    error.value = 'Invalid credentials'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold tracking-tight text-accent">
          DMP
        </h1>
        <p class="mt-1 text-sm text-ink0">
          Your music library
        </p>
      </div>

      <form class="space-y-3" @submit.prevent="handleSubmit">
        <input
          v-model="username"
          type="text"
          placeholder="Username"
          autocomplete="username"
          class="w-full rounded-lg border border-rule bg-bg-1 px-4 py-3 text-sm text-ink placeholder-ink-3 transition-colors focus:border-accent focus:outline-none"
        />
        <input
          v-model="password"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          class="w-full rounded-lg border border-rule bg-bg-1 px-4 py-3 text-sm text-ink placeholder-ink-3 transition-colors focus:border-accent focus:outline-none"
        />

        <p v-if="error" class="text-center text-sm text-red-400">
          {{ error }}
        </p>

        <UiButton type="submit" block :loading="loading" :disabled="!canSubmit">
          Sign in
        </UiButton>
      </form>
    </div>
  </div>
</template>
