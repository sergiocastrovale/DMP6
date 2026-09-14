<script setup lang="ts">
const open = defineModel<boolean>({ required: true })

defineProps<{
  message: string
  slug?: string | null
}>()
</script>

<template>
  <Dialog v-model="open" title="Can't add artist" size="sm">
    <template #content>
      <p class="text-base text-stone-100/70">{{ message }}</p>
    </template>
    <template #actions>
      <UiButton variant="ghost" size="sm" @click="open = false">
        Close
      </UiButton>
      <UiButton v-if="slug" variant="secondary" size="sm" :to="`/artist/${slug}`">
        Go to artist
      </UiButton>
    </template>
  </Dialog>
</template>
