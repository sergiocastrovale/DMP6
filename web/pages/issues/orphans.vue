<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Orphan Artists' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="orphans" />
  </IssuesShell>
</template>
