<script setup lang="ts">
import type { TabItem } from '~/types/ui'
import { cx, layout } from '~/helpers/ui'

defineProps<{
  breadcrumbRoot?: { label: string; to: string }
  breadcrumbLabels?: Record<string, string>
  tabs: TabItem[]
}>()
</script>

<template>
  <div :class="cx(layout.page)">
    <Breadcrumbs v-if="breadcrumbRoot" :root="breadcrumbRoot" :labels="breadcrumbLabels ?? {}" />
    <slot name="header" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
