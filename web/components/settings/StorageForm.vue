<script setup lang="ts">
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
  <div class="flex max-w-2xl flex-col gap-6">
    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">Image Storage</h2>
      <SettingsField
        v-model="form.imageStorage"
        label="Storage Mode"
        description="Where images are stored. Overrides IMAGE_STORAGE env var."
        type="select"
        :options="storageOptions"
      />
    </div>

    <div class="flex flex-col gap-5 rounded-xl border border-stone-100/6 bg-stone-900 p-6">
      <h2 class="text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">S3 / Compatible Storage</h2>
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

    <SettingsSaveBar :saving="saving" :saved="saved" :error="error" :disabled="!canEdit" @save="save" />
  </div>
</template>
