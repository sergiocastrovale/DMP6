<script setup lang="ts">
import { apiErrorMessage } from '~/helpers/apiError'
import { CheckCircle2, AlertCircle, ExternalLink, Unlink } from 'lucide-vue-next'
import { form } from '~/helpers/ui'

interface LastfmState {
  available: boolean
  connected: boolean
  username: string | null
}

const { data: state, refresh } = await useAsyncData('me-lastfm', () =>
  useCookieFetch<LastfmState>('/api/me/lastfm'),
)

const error = ref('')
const connecting = ref(false)
const disconnecting = ref(false)

const connect = async () => {
  error.value = ''
  connecting.value = true
  try {
    const { url } = await $fetch<{ url: string }>('/api/scrobble/connect')
    window.location.href = url
  }
  catch (e) {
    error.value = apiErrorMessage(e, 'Failed to start Last.fm auth')
    connecting.value = false
  }
}

const disconnect = async () => {
  error.value = ''
  disconnecting.value = true
  try {
    await $fetch('/api/me/lastfm', { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    error.value = apiErrorMessage(e, 'Failed to disconnect')
  }
  finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Last.fm" description="Scrobble what you listen to on your own Last.fm account">
      <div v-if="state?.connected" class="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3">
        <CheckCircle2 :size="18" class="text-success shrink-0" />
        <div class="flex-1">
          <p class="text-base text-success">
            Connected as <span class="font-semibold">{{ state.username }}</span>
          </p>
          <p class="text-sm text-stone-100/55">Your listens are scrobbled to this account</p>
        </div>
        <UiButton variant="danger" size="sm" :icon="Unlink" :loading="disconnecting" :disabled="disconnecting" @click="disconnect">
          {{ disconnecting ? 'Disconnecting…' : 'Disconnect' }}
        </UiButton>
      </div>

      <div v-else class="flex items-center gap-3 rounded-lg border border-stone-100/10 bg-stone-800/50 px-4 py-3">
        <AlertCircle :size="18" class="text-stone-100/55 shrink-0" />
        <p class="flex-1 text-base text-stone-100/60">
          {{ state?.available ? 'Not connected to Last.fm' : 'Last.fm is not set up yet - an admin adds the API key under Settings → API Keys' }}
        </p>
        <UiButton v-if="state?.available" variant="danger" :icon="ExternalLink" :loading="connecting" @click="connect">
          {{ connecting ? 'Redirecting…' : 'Connect Last.fm' }}
        </UiButton>
      </div>

      <p v-if="error" :class="form.error">
        {{ error }}
      </p>
    </UiCard>
  </div>
</template>
