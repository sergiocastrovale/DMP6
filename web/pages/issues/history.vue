<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: buildPageTitle('Issues', 'Fix History') })
</script>

<template>
  <IssuesShell>
    <IssuesHistoryContent />
  </IssuesShell>
</template>
