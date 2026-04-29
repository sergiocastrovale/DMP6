<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Enrichment Gaps' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="enrichment" />
  </IssuesShell>
</template>
