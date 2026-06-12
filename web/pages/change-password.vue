<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

const { user, loadMe } = useAuth()

const handleSubmit = async () => {
  error.value = ''

  if (newPassword.value.length < 6) {
    error.value = 'Password must be at least 6 characters'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      },
    })
    await loadMe()
    await navigateTo('/')
  } catch (e: any) {
    error.value = e.data?.message || 'Failed to change password'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold tracking-tight text-accent">DMP</h1>
        <p class="mt-1 text-sm text-ink0">Change your password</p>
      </div>

      <form class="space-y-3" @submit.prevent="handleSubmit">
        <input
          v-model="currentPassword"
          type="password"
          placeholder="Current password"
          autocomplete="current-password"
          class="w-full rounded-lg border border-rule bg-bg-1 px-4 py-3 text-sm text-ink placeholder-ink-3 transition-colors focus:border-accent focus:outline-none"
        />
        <input
          v-model="newPassword"
          type="password"
          placeholder="New password"
          autocomplete="new-password"
          class="w-full rounded-lg border border-rule bg-bg-1 px-4 py-3 text-sm text-ink placeholder-ink-3 transition-colors focus:border-accent focus:outline-none"
        />
        <input
          v-model="confirmPassword"
          type="password"
          placeholder="Confirm new password"
          autocomplete="new-password"
          class="w-full rounded-lg border border-rule bg-bg-1 px-4 py-3 text-sm text-ink placeholder-ink-3 transition-colors focus:border-accent focus:outline-none"
        />

        <p v-if="error" class="text-center text-sm text-red-400">{{ error }}</p>

        <UiButton type="submit" block :loading="loading">
          Change Password
        </UiButton>
      </form>
    </div>
  </div>
</template>
