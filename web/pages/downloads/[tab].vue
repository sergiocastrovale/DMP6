<script setup lang="ts">
import type { Component } from 'vue'
import DownloadsMonitoringTab from '~/components/downloads/MonitoringTab.vue'
import DownloadsMergeContent from '~/components/downloads/MergeContent.vue'
import DownloadsQueueContent from '~/components/downloads/QueueContent.vue'
import DownloadsHistoryContent from '~/components/downloads/HistoryContent.vue'
import DownloadsEventsContent from '~/components/downloads/EventsContent.vue'

const TABS: Record<string, { title: string; component: Component }> = {
  monitoring: { title: 'Monitoring', component: DownloadsMonitoringTab },
  merge: { title: 'Ready to merge', component: DownloadsMergeContent },
  queue: { title: 'Queue', component: DownloadsQueueContent },
  history: { title: 'History', component: DownloadsHistoryContent },
  events: { title: 'Events', component: DownloadsEventsContent },
}

definePageMeta({
  validate: route => (route.params.tab as string) in TABS,
})

const route = useRoute()
const tab = TABS[route.params.tab as string]!
useTitle('Downloads', tab.title)
</script>

<template>
  <DownloadsShell>
    <component :is="tab.component" />
  </DownloadsShell>
</template>
