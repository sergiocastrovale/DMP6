<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Unsplit Artists' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="unsplit" />
  </IssuesShell>
</template>
