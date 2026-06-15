<script setup lang="ts">
import type { TabItem } from '~/types/ui'

defineProps<{
  breadcrumbRoot: { label: string; to: string }
  breadcrumbLabels: Record<string, string>
  tabs: TabItem[]
}>()
</script>

<template>
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-24">
    <slot name="header" />
    <Breadcrumbs :root="breadcrumbRoot" :labels="breadcrumbLabels" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
