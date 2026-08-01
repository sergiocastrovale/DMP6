<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Mismatched Release ID' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="mismatched-release-id" />
  </IssuesShell>
</template>
