<script setup lang="ts">
import { surface } from '~/helpers/ui'

definePageMeta({ layout: 'auth' })

const username = ref('')
const password = ref('')
const rememberMe = ref(true)
const error = ref('')
const loading = ref(false)

const { login } = useAuth()

const canSubmit = computed(() => !!username.value && !!password.value && !loading.value)

const handleSubmit = async () => {
  if (!canSubmit.value) {return}
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value, rememberMe.value)
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
        <h1 class="font-display text-3xl font-bold tracking-[0.3em] text-amber-400">
          DMP
        </h1>
        <p class="mt-1 text-sm text-stone-100/40">
          Your music library
        </p>
      </div>

      <form :class="[surface.card, 'flex flex-col gap-4 p-8']" @submit.prevent="handleSubmit">
        <UiTextField
          v-model="username"
          label="Username"
          autocomplete="username"
        />
        <UiTextField
          v-model="password"
          type="password"
          label="Password"
          autocomplete="current-password"
          :error="error"
        />

        <UiCheckbox v-model="rememberMe" label="Keep me signed in" />

        <UiButton type="submit" block :loading="loading" :disabled="!canSubmit">
          Sign in
        </UiButton>
      </form>
    </div>
  </div>
</template>
