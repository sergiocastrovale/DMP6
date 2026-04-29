<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Missing Metadata' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="missing" />
  </IssuesShell>
</template>
