<script setup lang="ts">
definePageMeta({ middleware: 'admin' })
useTitle('Playlists', 'Generated playlist settings')
</script>

<template>
  <PlaylistGeneratorTable />
</template>
