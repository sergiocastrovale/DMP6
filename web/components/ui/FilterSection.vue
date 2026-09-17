<script setup lang="ts">
import { typography } from '~/helpers/ui'

defineProps<{
  title: string
}>()
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <h3 :class="typography.sectionLabel">{{ title }}</h3>
        <slot name="title-extra" />
      </div>
      <slot name="header-right" />
    </div>
    <slot />
  </section>
</template>
