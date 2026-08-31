<script setup lang="ts">
import { surface } from '~/helpers/ui'

definePageMeta({ layout: 'auth' })

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const fieldErrors = ref({ current: '', new: '', confirm: '' })
const loading = ref(false)

const { loadMe } = useAuth()

const handleSubmit = async () => {
  fieldErrors.value = { current: '', new: '', confirm: '' }

  if (newPassword.value.length < 6) {
    fieldErrors.value.new = 'Password must be at least 6 characters'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    fieldErrors.value.confirm = 'Passwords do not match'
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
  }
  catch (e: any) {
    fieldErrors.value.current = e.data?.message || 'Failed to change password'
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
        <h1 class="font-display text-3xl font-bold tracking-[0.3em] text-amber-400">DMP</h1>
        <p class="mt-1 text-sm text-stone-100/55">Change your password</p>
      </div>

      <form :class="[surface.card, 'flex flex-col gap-4 p-8']" @submit.prevent="handleSubmit">
        <UiTextField
          v-model="currentPassword"
          type="password"
          label="Current password"
          autocomplete="current-password"
          :error="fieldErrors.current"
        />
        <UiTextField
          v-model="newPassword"
          type="password"
          label="New password"
          autocomplete="new-password"
          :error="fieldErrors.new"
        />
        <UiTextField
          v-model="confirmPassword"
          type="password"
          label="Confirm new password"
          autocomplete="new-password"
          :error="fieldErrors.confirm"
        />

        <UiButton type="submit" block :loading="loading">
          Change Password
        </UiButton>
      </form>
    </div>
  </div>
</template>
