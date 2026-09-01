<script setup lang="ts">
const TABS: Record<string, { title: string; component: string }> = {
  monitoring: { title: 'Monitoring', component: 'DownloadsMonitoringTab' },
  merge: { title: 'Ready to merge', component: 'DownloadsMergeContent' },
  downloading: { title: 'Downloading', component: 'DownloadsDownloadingContent' },
  failed: { title: 'Failed', component: 'DownloadsFailedContent' },
  unavailable: { title: 'Unavailable', component: 'DownloadsUnavailableContent' },
  rejected: { title: 'Rejected', component: 'DownloadsRejectedContent' },
  history: { title: 'History', component: 'DownloadsHistoryContent' },
  events: { title: 'Events', component: 'DownloadsEventsContent' },
}

definePageMeta({
  validate: route => (route.params.tab as string) in TABS,
})

const route = useRoute()
const tab = TABS[route.params.tab as string]!
useHead({ title: `Downloads · ${tab.title}` })
</script>

<template>
  <DownloadsShell>
    <component :is="tab.component" />
  </DownloadsShell>
</template>
