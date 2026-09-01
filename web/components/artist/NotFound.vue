<script setup lang="ts">
import { Disc3, ArrowLeft } from 'lucide-vue-next'
</script>

<template>
  <div class="py-20 text-center">
    <Disc3 class="w-15 h-15 mx-auto mb-5" />
    <p class="text-4xl font-medium text-stone-100">Artist not found</p>
    <p class="mt-1 text-lg text-stone-100/60">The artist you're looking for doesn't exist!</p>
    
    <div class="mt-4">
      <NuxtLink to="/">
        <UiButton variant="primary" size="lg">
          <ArrowLeft class="w-4 h-4" />
          Back home
        </UiButton>
      </NuxtLink>  
    </div>
  </div>
</template>
