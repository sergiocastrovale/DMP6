<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Fix History' })
</script>

<template>
  <IssuesShell>
    <IssuesHistoryContent />
  </IssuesShell>
</template>
