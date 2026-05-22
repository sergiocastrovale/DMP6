<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

type PermData = {
  matrix: Record<string, string[]>
  allPermissions: string[]
}

const { data, refresh } = await useAsyncData('settings-perms', () =>
  $fetch<PermData>('/api/permissions'),
)

const matrix = ref<Record<string, Set<string>>>({
  VIEWER: new Set(data.value?.matrix.VIEWER ?? []),
  MANAGER: new Set(data.value?.matrix.MANAGER ?? []),
  ADMIN: new Set(data.value?.matrix.ADMIN ?? []),
})

watch(data, (d) => {
  if (!d) return
  matrix.value = {
    VIEWER: new Set(d.matrix.VIEWER),
    MANAGER: new Set(d.matrix.MANAGER),
    ADMIN: new Set(d.matrix.ADMIN),
  }
})

const allPermissions = computed(() => data.value?.allPermissions ?? [])
const roles = ['VIEWER', 'MANAGER', 'ADMIN'] as const

const toggle = (role: string, perm: string) => {
  const s = matrix.value[role]!
  if (s.has(perm)) {
    s.delete(perm)
  } else {
    s.add(perm)
  }
}

const saving = ref(false)
const saved = ref(false)
const error = ref('')

const save = async () => {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const body: Record<string, string[]> = {}
    for (const role of roles) {
      body[role] = Array.from(matrix.value[role]!)
    }
    await $fetch('/api/permissions', { method: 'PUT', body: { matrix: body } })
    saved.value = true
    await refresh()
    setTimeout(() => { saved.value = false }, 2000)
  } catch (e: any) {
    error.value = e.data?.message || 'Failed to save permissions'
  } finally {
    saving.value = false
  }
}

const permLabel = (p: string) => {
  const [feature, action] = p.split('.')
  return { feature, action }
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Role Permissions</h2>

      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-rule text-left text-xs uppercase tracking-wider text-ink0">
            <th class="pb-2 pr-4">Permission</th>
            <th v-for="role in roles" :key="role" class="pb-2 px-4 text-center">{{ role.toLowerCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="perm in allPermissions"
            :key="perm"
            class="border-b border-rule"
          >
            <td class="py-2 pr-4">
              <span class="text-ink-2">{{ permLabel(perm).feature }}</span>
              <span class="text-ink0">.{{ permLabel(perm).action }}</span>
            </td>
            <td v-for="role in roles" :key="role" class="py-2 px-4 text-center">
              <input
                type="checkbox"
                :checked="matrix[role]?.has(perm) ?? false"
                @change="toggle(role, perm)"
                class="h-4 w-4 rounded border-rule bg-bg-2 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-500"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div class="flex items-center gap-3 pt-2">
        <button
          :disabled="saving"
          @click="save"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Save :size="15" />
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="saved" class="flex items-center gap-1.5 text-sm text-emerald-400">
          <CheckCircle2 :size="15" /> Saved
        </span>
        <span v-if="error" class="flex items-center gap-1.5 text-sm text-red-400">
          <AlertCircle :size="15" /> {{ error }}
        </span>
      </div>
    </div>
  </div>
</template>
