<script setup lang="ts">
import type { TabItem } from '~/types/ui'

defineProps<{
  breadcrumbRoot: { label: string; to: string }
  breadcrumbLabels: Record<string, string>
  tabs: TabItem[]
}>()
</script>

<template>
  <div class="flex flex-col gap-6 pb-24">
    <slot name="header" />
    <Breadcrumbs :root="breadcrumbRoot" :labels="breadcrumbLabels" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
