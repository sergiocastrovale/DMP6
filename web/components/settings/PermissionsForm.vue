<script setup lang="ts">
import type { PermissionsMatrixResponse } from '~/types/auth'
import { cx, data as tableCell } from '~/helpers/ui'

const { data, refresh } = await useAsyncData('settings-perms', () =>
  $fetch<PermissionsMatrixResponse>('/api/permissions'),
)

const matrix = ref<Record<string, Set<string>>>({
  VIEWER: new Set(data.value?.matrix.VIEWER ?? []),
  MANAGER: new Set(data.value?.matrix.MANAGER ?? []),
  ADMIN: new Set(data.value?.matrix.ADMIN ?? []),
})

watch(data, (d) => {
  if (!d) {return}
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
  save()
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
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Role Permissions">
      <SlimTable>
        <SlimTableHeader>
          <th :class="cx(tableCell.th, 'text-left')">Permission</th>
          <th v-for="role in roles" :key="role" :class="cx(tableCell.th, 'text-center')">{{ role.toLowerCase() }}</th>
        </SlimTableHeader>
        <SlimTableBody>
          <SlimTableRow v-for="perm in allPermissions" :key="perm">
            <td :class="tableCell.td">
              <span class="text-stone-100/60">{{ permLabel(perm).feature }}</span>
              <span class="text-stone-100/55">.{{ permLabel(perm).action }}</span>
            </td>
            <td v-for="role in roles" :key="role" :class="cx(tableCell.td, 'text-center')">
              <UiCheckbox
                :model-value="matrix[role]?.has(perm) ?? false"
                :aria-label="`${perm} for ${role.toLowerCase()}`"
                @update:model-value="toggle(role, perm)"
              />
            </td>
          </SlimTableRow>
        </SlimTableBody>
      </SlimTable>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" />
    </UiCard>
  </div>
</template>
