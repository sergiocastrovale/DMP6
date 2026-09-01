<script setup lang="ts">
const TITLES: Record<string, string> = {
  corrupted: 'Corrupted TPE2',
  'duplicate-release': 'Duplicate Releases',
  duplicates: 'Duplicate Artists',
  enrichment: 'Enrichment Gaps',
  'mismatched-release-id': 'Mismatched Release ID',
  missing: 'Missing Metadata',
  orphans: 'Orphan Artists',
}

definePageMeta({
  layout: 'admin',
  middleware: 'admin',
  validate: route => (route.params.type as string) in TITLES,
})

const route = useRoute()
const type = route.params.type as string
useHead({ title: buildPageTitle('Issues', TITLES[type]) })
</script>

<template>
  <IssuesShell>
    <IssuesTypeContent :type="type" />
  </IssuesShell>
</template>
