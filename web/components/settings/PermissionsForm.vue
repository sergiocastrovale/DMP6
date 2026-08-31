<script setup lang="ts">
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
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Role Permissions</h2>

      <SlimTable>
        <SlimTableHeader>
          <th class="px-3 py-2.5 text-left">Permission</th>
          <th v-for="role in roles" :key="role" class="px-3 py-2.5 text-center">{{ role.toLowerCase() }}</th>
        </SlimTableHeader>
        <SlimTableBody>
          <SlimTableRow v-for="perm in allPermissions" :key="perm">
            <td class="px-3 py-3">
              <span class="text-stone-100/60">{{ permLabel(perm).feature }}</span>
              <span class="text-stone-100/55">.{{ permLabel(perm).action }}</span>
            </td>
            <td v-for="role in roles" :key="role" class="px-3 py-3 text-center">
              <UiCheckbox
                :model-value="matrix[role]?.has(perm) ?? false"
                :aria-label="`${perm} for ${role.toLowerCase()}`"
                @update:model-value="toggle(role, perm)"
              />
            </td>
          </SlimTableRow>
        </SlimTableBody>
      </SlimTable>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" label="Save" @save="save" />
    </div>
  </div>
</template>
