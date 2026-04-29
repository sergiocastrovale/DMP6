<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Corrupted TPE2' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="corrupted" />
  </IssuesShell>
</template>
