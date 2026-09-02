<script setup lang="ts">
import { typography } from '~/helpers/ui'
</script>

<template>
  <p :class="typography.body">
    <slot />
  </p>
</template>
