<script setup lang="ts">
import { cx, typography } from '~/helpers/ui'
</script>

<template>
  <thead>
    <tr :class="cx('border-b border-stone-100/6 bg-stone-800/50 h-[38px]', typography.sectionLabel)">
      <slot />
    </tr>
  </thead>
</template>
