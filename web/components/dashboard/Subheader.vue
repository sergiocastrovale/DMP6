<script setup lang="ts">
const { user } = useAuth()
</script>

<template>
  <div class="flex flex-col gap-1">
    <h1 class="font-display text-5xl font-semibold text-ink">
      Hello, {{ user?.username }}
    </h1>
    <p class="text-lg text-ink-3">
      What are you listening to today?
    </p>
  </div>
</template>
