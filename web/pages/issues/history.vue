<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useTitle('Issues', 'Fix History')
</script>

<template>
  <IssuesShell>
    <IssuesHistoryContent />
  </IssuesShell>
</template>
