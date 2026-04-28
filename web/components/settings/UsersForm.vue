<script setup lang="ts">
import { Plus, Trash2, KeyRound, Save, AlertCircle } from 'lucide-vue-next'

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
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Users</h2>
        <button
          @click="showCreate = !showCreate"
          class="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus :size="14" /> New User
        </button>
      </div>

      <div v-if="showCreate" class="rounded border border-zinc-700 bg-zinc-800 p-4 space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <input
            v-model="newUser.username"
            placeholder="Username"
            class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
          <input
            v-model="newUser.email"
            placeholder="Email"
            type="email"
            class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
          <input
            v-model="newUser.password"
            placeholder="Password"
            type="password"
            class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
          <select
            v-model="newUser.role"
            class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
          >
            <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </div>
        <p v-if="createError" class="text-sm text-red-400">{{ createError }}</p>
        <div class="flex gap-2">
          <button
            :disabled="creating"
            @click="createUser"
            class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
          <button
            @click="showCreate = false"
            class="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
          >
            Cancel
          </button>
        </div>
      </div>

      <p v-if="deleteError" class="flex items-center gap-1.5 text-sm text-red-400">
        <AlertCircle :size="14" /> {{ deleteError }}
      </p>

      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-700 text-left text-xs uppercase tracking-wider text-zinc-500">
            <th class="pb-2 pr-4">Username</th>
            <th class="pb-2 pr-4">Email</th>
            <th class="pb-2 pr-4">Role</th>
            <th class="pb-2 pr-4">Status</th>
            <th class="pb-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.id"
            class="border-b border-zinc-800"
          >
            <template v-if="editingId === u.id">
              <td class="py-2 pr-4 text-zinc-200">{{ u.username }}</td>
              <td class="py-2 pr-4">
                <input
                  v-model="editForm.email"
                  class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </td>
              <td class="py-2 pr-4">
                <select
                  v-model="editForm.role"
                  class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                >
                  <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>
              </td>
              <td class="py-2 pr-4">
                <input
                  v-model="editForm.password"
                  type="password"
                  placeholder="New pw (optional)"
                  class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </td>
              <td class="py-2 text-right space-x-1">
                <button
                  :disabled="saving"
                  @click="saveEdit(u.id)"
                  class="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <Save :size="12" />
                </button>
                <button
                  @click="cancelEdit"
                  class="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
                >
                  Cancel
                </button>
                <p v-if="editError" class="mt-1 text-xs text-red-400">{{ editError }}</p>
              </td>
            </template>
            <template v-else>
              <td class="py-2 pr-4 text-zinc-200">{{ u.username }}</td>
              <td class="py-2 pr-4 text-zinc-400">{{ u.email }}</td>
              <td class="py-2 pr-4">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="{
                    'bg-amber-500/20 text-amber-400': u.role === 'ADMIN',
                    'bg-blue-500/20 text-blue-400': u.role === 'MANAGER',
                    'bg-zinc-700 text-zinc-300': u.role === 'VIEWER',
                  }"
                >
                  {{ u.role.toLowerCase() }}
                </span>
              </td>
              <td class="py-2 pr-4">
                <span v-if="u.mustChangePassword" class="flex items-center gap-1 text-xs text-yellow-500">
                  <KeyRound :size="12" /> must change pw
                </span>
                <span v-else class="text-xs text-zinc-500">active</span>
              </td>
              <td class="py-2 text-right space-x-1">
                <button
                  @click="startEdit(u)"
                  class="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
                >
                  Edit
                </button>
                <button
                  @click="deleteUser(u.id)"
                  class="rounded bg-red-900/50 px-2 py-1 text-xs text-red-400 hover:bg-red-900"
                >
                  <Trash2 :size="12" />
                </button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
