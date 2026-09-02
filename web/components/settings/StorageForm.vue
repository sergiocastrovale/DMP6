<script setup lang="ts">
import { grid } from '~/helpers/ui'
import { urlField, validateField } from '~/helpers/settingsValidation'

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

const fieldErrors = reactive({
  storageEndpoint: '',
  storagePublicUrl: '',
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

const onImageStorageChange = (v: string) => {
  form.imageStorage = v
  save()
}

const onUrlBlur = (field: 'storageEndpoint' | 'storagePublicUrl') => {
  fieldErrors[field] = validateField(urlField, form[field])
  if (!fieldErrors[field]) {save()}
}
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Image Storage">
      <SettingsField
        :model-value="form.imageStorage"
        label="Storage Mode"
        description="Where images are stored. Overrides IMAGE_STORAGE env var."
        type="select"
        :options="storageOptions"
        :disabled="!canEdit"
        @update:model-value="onImageStorageChange($event as string)"
      />
    </UiCard>

    <UiCard title="S3 / Compatible Storage">
      <div :class="grid.halfRow" class="mb-4">
        <SettingsField
          v-model="form.storageEndpoint"
          label="S3 Endpoint"
          description="Leave empty for AWS S3. Set for S3-compatible services (Backblaze, MinIO). Overrides STORAGE_ENDPOINT."
          placeholder="https://s3.us-west-001.backblazeb2.com"
          :error="fieldErrors.storageEndpoint"
          :disabled="!canEdit"
          @blur="onUrlBlur('storageEndpoint')"
        />
        <SettingsField
          v-model="form.storagePublicUrl"
          label="Public URL"
          description="Public base URL for serving S3 images. Overrides STORAGE_PUBLIC_URL."
          placeholder="https://your-bucket.s3.us-east-1.amazonaws.com"
          :error="fieldErrors.storagePublicUrl"
          :disabled="!canEdit"
          @blur="onUrlBlur('storagePublicUrl')"
        />
      </div>

      <div :class="grid.halfRow">
        <SettingsField
          v-model="form.storageImageBucket"
          label="Image Bucket"
          description="S3 bucket for release and artist images. Overrides STORAGE_IMAGE_BUCKET."
          placeholder="my-dmp-images"
          :disabled="!canEdit"
          @blur="save"
        />
        <SettingsField
          v-model="form.storageBackupsBucket"
          label="Backups Bucket"
          description="S3 bucket for backups. Overrides STORAGE_BACKUPS_BUCKET."
          placeholder="my-dmp-backups"
          :disabled="!canEdit"
          @blur="save"
        />
        <SettingsField
          v-model="form.awsRegion"
          label="AWS Region"
          description="Overrides AWS_REGION."
          placeholder="us-east-1"
          :disabled="!canEdit"
          @blur="save"
        />
        <SettingsField
          v-model="form.awsAccessKeyId"
          label="Access Key ID"
          description="Overrides AWS_ACCESS_KEY_ID."
          placeholder="AKIAIOSFODNN7EXAMPLE"
          :disabled="!canEdit"
          @blur="save"
        />
        <SettingsField
          v-model="form.awsSecretAccessKey"
          label="Secret Access Key"
          description="Overrides AWS_SECRET_ACCESS_KEY."
          type="password"
          :placeholder="settings?.awsSecretAccessKeySet ? 'Set — leave blank to keep' : '••••••••'"
          :disabled="!canEdit"
          @blur="save"
        />
      </div>

      <SettingsSaveBar :saving="saving" :saved="saved" :error="error" class="pt-2" />
    </UiCard>
  </div>
</template>
