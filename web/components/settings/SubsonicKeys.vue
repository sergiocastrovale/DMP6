<script setup lang="ts">
import { Plus, Trash2, Copy, Check, AlertCircle } from 'lucide-vue-next'
import { cx, data, form } from '~/helpers/ui'

interface ApiKeySummary {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const { data: keys, refresh } = await useAsyncData('subsonic-api-keys', () =>
  useCookieFetch<ApiKeySummary[]>('/api/me/api-keys'),
)

const activeKeys = computed(() => (keys.value ?? []).filter(k => !k.revokedAt))

const showCreate = ref(false)
const newKeyName = ref('')
const createError = ref('')
const creating = ref(false)

// The plaintext key only ever exists here, right after creation - never persisted, never
// refetchable. Cleared on dismiss.
const revealedKey = ref('')
const copied = ref(false)

const deleteError = ref('')

const createKey = async () => {
  createError.value = ''
  const name = newKeyName.value.trim()
  if (!name) {
    createError.value = 'Name is required'
    return
  }
  creating.value = true
  try {
    const result = await $fetch<{ id: string, key: string }>('/api/me/api-keys', {
      method: 'POST',
      body: { name },
    })
    revealedKey.value = result.key
    showCreate.value = false
    newKeyName.value = ''
    await refresh()
  } catch (e: any) {
    createError.value = e.data?.message || 'Failed to create key'
  } finally {
    creating.value = false
  }
}

const revokeKey = async (id: string) => {
  deleteError.value = ''
  try {
    await $fetch(`/api/me/api-keys/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    deleteError.value = e.data?.message || 'Failed to revoke key'
  }
}

const copyKey = async () => {
  try {
    await navigator.clipboard.writeText(revealedKey.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard API unavailable (non-HTTPS, permission denied) - the key is still on screen to
    // copy by hand, so this is a silent no-op rather than an error banner.
  }
}

const serverUrl = computed(() => import.meta.client ? window.location.origin : '')
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Subsonic API keys">
      <template #actions>
        <UiButton size="sm" :icon="Plus" @click="showCreate = !showCreate">
          New Key
        </UiButton>
      </template>

      <p class="text-sm text-stone-100/55">
        Use a Subsonic-compatible app (Symfonium, Amperfy, play:Sub, Substreamer, Feishin, ...) to
        stream from DMP - offline downloads, Android Auto and CarPlay included. Point the app at
        <code class="rounded bg-stone-950 px-1.5 py-0.5 text-stone-100/70">{{ serverUrl }}</code>
        and use a key below as the API key (not your account password).
      </p>

      <div v-if="revealedKey" class="flex flex-col gap-2 rounded-lg border border-amber-400/45 bg-amber-400/10 p-4">
        <p class="flex items-center gap-1.5 text-sm font-medium text-amber-400">
          <AlertCircle :size="14" /> Copy this key now - it won't be shown again.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 truncate rounded-md bg-stone-950 px-3 py-2 text-sm text-stone-100">{{ revealedKey }}</code>
          <UiButton size="sm" variant="secondary" :icon="copied ? Check : Copy" @click="copyKey">
            {{ copied ? 'Copied' : 'Copy' }}
          </UiButton>
        </div>
        <button type="button" class="self-start text-sm text-stone-100/55 hover:text-stone-100" @click="revealedKey = ''">
          Done
        </button>
      </div>

      <div v-if="showCreate" class="flex flex-col gap-3 rounded-lg border border-stone-100/10 bg-stone-950 p-4">
        <UiTextField v-model="newKeyName" label="Name" placeholder="e.g. Symfonium - phone" @keyup.enter="createKey" />
        <p v-if="createError" role="alert" :class="form.error">{{ createError }}</p>
        <div class="flex gap-2">
          <UiButton size="sm" :loading="creating" @click="createKey">
            Create
          </UiButton>
          <UiButton variant="secondary" size="sm" @click="showCreate = false">
            Cancel
          </UiButton>
        </div>
      </div>

      <p v-if="deleteError" role="alert" :class="[form.error, 'flex items-center gap-1.5']">
        <AlertCircle :size="14" /> {{ deleteError }}
      </p>

      <SlimTable v-if="activeKeys.length">
        <SlimTableHeader>
          <th :class="cx(data.th, 'text-left')">Name</th>
          <th :class="cx(data.th, 'text-left')">Key</th>
          <th :class="cx(data.th, 'text-left')">Created</th>
          <th :class="cx(data.th, 'text-left')">Last used</th>
          <th :class="cx(data.th, 'text-right')">Actions</th>
        </SlimTableHeader>
        <SlimTableBody>
          <SlimTableRow v-for="k in activeKeys" :key="k.id">
            <td :class="cx(data.td, 'text-stone-100')">{{ k.name }}</td>
            <td :class="cx(data.td, 'font-mono text-stone-100/55')">{{ k.prefix }}...</td>
            <td :class="cx(data.td, 'text-stone-100/55')">{{ new Date(k.createdAt).toLocaleDateString() }}</td>
            <td :class="cx(data.td, 'text-stone-100/55')">
              {{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never' }}
            </td>
            <td :class="cx(data.td, 'text-right')" @click.stop>
              <DataTableAction :icon="Trash2" :label="`Revoke ${k.name}`" @click="revokeKey(k.id)" />
            </td>
          </SlimTableRow>
        </SlimTableBody>
      </SlimTable>
      <p v-else class="text-sm text-stone-100/55">
        No keys yet. Create one to connect a Subsonic app.
      </p>
    </UiCard>
  </div>
</template>
