<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues · Duplicate Releases' })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent type="duplicate-release" />
  </IssuesShell>
</template>
