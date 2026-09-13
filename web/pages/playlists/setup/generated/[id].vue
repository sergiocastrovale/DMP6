<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

const route = useRoute()
const id = route.params.id as string

useTitle('Playlists', 'Edit playlist generator')
</script>

<template>
  <PlaylistGeneratorForm :id="id" />
</template>
