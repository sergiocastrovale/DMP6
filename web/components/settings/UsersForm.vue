<script setup lang="ts">
import { Plus, Trash2, Pencil, KeyRound, Save, X, AlertCircle } from 'lucide-vue-next'
import { form, toneBg, toneText } from '~/helpers/ui'

type User = {
  id: number
  username: string
  email: string
  role: string
  mustChangePassword: boolean
  createdAt: string
}

const { data: users, refresh } = await useAsyncData('settings-users', () =>
  $fetch<User[]>('/api/users'),
)

const showCreate = ref(false)
const newUser = reactive({ username: '', email: '', password: '', role: 'VIEWER' })
const createError = ref('')
const creating = ref(false)

const editingId = ref<number | null>(null)
const editForm = reactive({ email: '', role: '', password: '' })
const editError = ref('')
const saving = ref(false)

const deleteError = ref('')

const createUser = async () => {
  createError.value = ''
  creating.value = true
  try {
    await $fetch('/api/users', { method: 'POST', body: { ...newUser } })
    showCreate.value = false
    newUser.username = ''
    newUser.email = ''
    newUser.password = ''
    newUser.role = 'VIEWER'
    await refresh()
  } catch (e: any) {
    createError.value = e.data?.message || 'Failed to create user'
  } finally {
    creating.value = false
  }
}

const startEdit = (u: User) => {
  editingId.value = u.id
  editForm.email = u.email
  editForm.role = u.role
  editForm.password = ''
  editError.value = ''
}

const cancelEdit = () => {
  editingId.value = null
}

const saveEdit = async (id: number) => {
  editError.value = ''
  saving.value = true
  try {
    const body: Record<string, string> = { email: editForm.email, role: editForm.role }
    if (editForm.password) {
      body.password = editForm.password
    }
    await $fetch(`/api/users/${id}`, { method: 'PATCH', body })
    editingId.value = null
    await refresh()
  } catch (e: any) {
    editError.value = e.data?.message || 'Failed to update user'
  } finally {
    saving.value = false
  }
}

const deleteUser = async (id: number) => {
  deleteError.value = ''
  try {
    await $fetch(`/api/users/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    deleteError.value = e.data?.message || 'Failed to delete user'
  }
}

const roles = [
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
]

const roleTone = (role: string) => role === 'ADMIN' ? toneBg.accent : role === 'MANAGER' ? toneBg.info : toneBg.muted
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Users</h2>
        <UiButton size="sm" :icon="Plus" @click="showCreate = !showCreate">
          New User
        </UiButton>
      </div>

      <div v-if="showCreate" class="flex flex-col gap-3 rounded-lg border border-stone-100/6 bg-stone-950 p-4">
        <div class="grid grid-cols-2 gap-3">
          <input v-model="newUser.username" placeholder="Username" :class="form.input">
          <input v-model="newUser.email" placeholder="Email" type="email" :class="form.input">
          <input v-model="newUser.password" placeholder="Password" type="password" :class="form.input">
          <div class="relative">
            <select v-model="newUser.role" :class="form.select">
              <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </div>
        </div>
        <p v-if="createError" role="alert" :class="form.error">{{ createError }}</p>
        <div class="flex gap-2">
          <UiButton size="sm" :loading="creating" @click="createUser">
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

      <SlimTable>
        <SlimTableHeader>
          <th class="px-3 py-2.5 text-left">Username</th>
          <th class="px-3 py-2.5 text-left">Email</th>
          <th class="px-3 py-2.5 text-left">Role</th>
          <th class="px-3 py-2.5 text-left">Status</th>
          <th class="px-3 py-2.5 text-right">Actions</th>
        </SlimTableHeader>
        <SlimTableBody>
          <SlimTableRow v-for="u in users" :key="u.id">
            <template v-if="editingId === u.id">
              <td class="px-3 py-3 text-stone-100">{{ u.username }}</td>
              <td class="px-3 py-3">
                <input v-model="editForm.email" :class="[form.input, 'h-[34px]']">
              </td>
              <td class="px-3 py-3">
                <div class="relative">
                  <select v-model="editForm.role" :class="[form.select, 'h-[34px]']">
                    <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
                  </select>
                </div>
              </td>
              <td class="px-3 py-3">
                <input v-model="editForm.password" type="password" placeholder="New pw (optional)" :class="[form.input, 'h-[34px]']">
              </td>
              <td class="px-3 py-3 text-right" @click.stop>
                <div class="flex items-center justify-end gap-1.5">
                  <UiButton size="sm" icon-only :icon="Save" :loading="saving" aria-label="Save user" @click="saveEdit(u.id)" />
                  <UiButton variant="secondary" size="sm" icon-only :icon="X" aria-label="Cancel edit" @click="cancelEdit" />
                </div>
                <p v-if="editError" role="alert" class="mt-1 text-xs text-danger">{{ editError }}</p>
              </td>
            </template>
            <template v-else>
              <td class="px-3 py-3 text-stone-100">{{ u.username }}</td>
              <td class="px-3 py-3 text-stone-100/60">{{ u.email }}</td>
              <td class="px-3 py-3">
                <span :class="[roleTone(u.role), 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium']">
                  {{ u.role.toLowerCase() }}
                </span>
              </td>
              <td class="px-3 py-3">
                <span v-if="u.mustChangePassword" :class="[toneText.warning, 'flex items-center gap-1 text-xs']">
                  <KeyRound :size="12" /> must change pw
                </span>
                <span v-else class="text-xs text-stone-100/55">active</span>
              </td>
              <td class="px-3 py-3 text-right" @click.stop>
                <div class="flex items-center justify-end gap-1.5">
                  <UiButton variant="secondary" size="sm" icon-only :icon="Pencil" :aria-label="`Edit ${u.username}`" @click="startEdit(u)" />
                  <UiButton variant="danger" size="sm" icon-only :icon="Trash2" :aria-label="`Delete ${u.username}`" @click="deleteUser(u.id)" />
                </div>
              </td>
            </template>
          </SlimTableRow>
        </SlimTableBody>
      </SlimTable>
    </div>
  </div>
</template>
