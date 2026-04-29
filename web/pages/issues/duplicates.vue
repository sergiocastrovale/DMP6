<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Duplicate Artists' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="duplicates" />
  </IssuesShell>
</template>
