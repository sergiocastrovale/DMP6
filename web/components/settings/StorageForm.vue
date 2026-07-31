<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

const { hasPerm } = useAuth()
const canEdit = hasPerm('variables.edit')

const { data: settings, refresh } = await useAsyncData('settings-db', () =>
  $fetch<Record<string, any>>('/api/settings'),
)

const form = reactive({
  imageStorage: settings.value?.imageStorage ?? '',
  storageImageBucket: settings.value?.storageImageBucket ?? '',
  storageBackupsBucket: settings.value?.storageBackupsBucket ?? '',
  awsRegion: settings.value?.awsRegion ?? '',
  awsAccessKeyId: settings.value?.awsAccessKeyId ?? '',
  awsSecretAccessKey: settings.value?.awsSecretAccessKey ?? '',
  storageEndpoint: settings.value?.storageEndpoint ?? '',
  storagePublicUrl: settings.value?.storagePublicUrl ?? '',
})

const storageOptions = [
  { value: 'local', label: 'Local' },
  { value: 's3', label: 'S3 only' },
  { value: 'both', label: 'Local + S3' },
]

const settingsStore = useSettingsStore()

const { saving, saved, error, save } = useFormSave(async () => {
  await $fetch('/api/settings', {
    method: 'PUT',
    body: {
      imageStorage: form.imageStorage || null,
      storageImageBucket: form.storageImageBucket || null,
      storageBackupsBucket: form.storageBackupsBucket || null,
      awsRegion: form.awsRegion || null,
      awsAccessKeyId: form.awsAccessKeyId || null,
      awsSecretAccessKey: form.awsSecretAccessKey || undefined,
      storageEndpoint: form.storageEndpoint || null,
      storagePublicUrl: form.storagePublicUrl || null,
    },
  })
  await refresh()
  await settingsStore.load()
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">Image Storage</h2>
      <SettingsField
        v-model="form.imageStorage"
        label="Storage Mode"
        description="Where images are stored. Overrides IMAGE_STORAGE env var."
        type="select"
        :options="storageOptions"
      />
    </div>

    <div class="rounded-lg border border-rule bg-bg-1 p-6 space-y-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-2">S3 / Compatible Storage</h2>
      <SettingsField
        v-model="form.storageImageBucket"
        label="Image Bucket"
        description="S3 bucket for release and artist images. Overrides STORAGE_IMAGE_BUCKET."
        placeholder="my-dmp-images"
      />
      <SettingsField
        v-model="form.storageBackupsBucket"
        label="Backups Bucket"
        description="S3 bucket for backups. Overrides STORAGE_BACKUPS_BUCKET."
        placeholder="my-dmp-backups"
      />
      <SettingsField
        v-model="form.awsRegion"
        label="AWS Region"
        description="Overrides AWS_REGION."
        placeholder="us-east-1"
      />
      <SettingsField
        v-model="form.awsAccessKeyId"
        label="Access Key ID"
        description="Overrides AWS_ACCESS_KEY_ID."
        placeholder="AKIAIOSFODNN7EXAMPLE"
      />
      <SettingsField
        v-model="form.awsSecretAccessKey"
        label="Secret Access Key"
        description="Overrides AWS_SECRET_ACCESS_KEY."
        type="password"
        :placeholder="settings?.awsSecretAccessKeySet ? 'Set — leave blank to keep' : '••••••••'"
      />
      <SettingsField
        v-model="form.storageEndpoint"
        label="S3 Endpoint"
        description="Leave empty for AWS S3. Set for S3-compatible services (Backblaze, MinIO). Overrides STORAGE_ENDPOINT."
        placeholder="https://s3.us-west-001.backblazeb2.com"
      />
      <SettingsField
        v-model="form.storagePublicUrl"
        label="Public URL"
        description="Public base URL for serving S3 images. Overrides STORAGE_PUBLIC_URL."
        placeholder="https://your-bucket.s3.us-east-1.amazonaws.com"
      />
    </div>

    <div class="flex items-center gap-3">
      <button
        :disabled="saving || !canEdit"
        class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        @click="save"
      >
        <Save :size="15" />
        {{ saving ? 'Saving…' : 'Save Changes' }}
      </button>
      <span v-if="saved" class="flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 :size="15" /> Saved
      </span>
      <span v-if="error" class="flex items-center gap-1.5 text-sm text-red-400">
        <AlertCircle :size="15" /> {{ error }}
      </span>
    </div>
  </div>
</template>
