<script setup lang="ts">
interface TabItem {
  key: string
  label: string
  href?: string
  count?: number
  countHighlight?: boolean
}

defineProps<{
  tabs: TabItem[]
}>()

const activeTab = defineModel<string>()
const route = useRoute()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 border-b border-rule">
    <slot name="prepend" />
    <div class="flex flex-wrap items-center gap-1">
      <template v-for="tab in tabs" :key="tab.key">
        <NuxtLink
          v-if="tab.href"
          :to="tab.href"
          class="-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
          :class="route.path === tab.href
            ? 'border-b-2 border-accent text-ink'
            : 'border-b-2 border-transparent text-ink-2 hover:text-ink'"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.count !== undefined"
            class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            :class="tab.countHighlight && tab.count > 0
              ? 'bg-accent-soft text-accent'
              : 'bg-bg-2 text-ink-2'"
          >{{ tab.count }}</span>
        </NuxtLink>
        <button
          v-else
          type="button"
          class="-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'border-b-2 border-accent text-ink'
            : 'border-b-2 border-transparent text-ink-2 hover:text-ink'"
          @click="activeTab = tab.key"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.count !== undefined"
            class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            :class="tab.countHighlight && tab.count > 0
              ? 'bg-accent-soft text-accent'
              : 'bg-bg-2 text-ink-2'"
          >{{ tab.count }}</span>
        </button>
      </template>
    </div>
    <div class="flex-1" />
    <slot name="append" />
  </div>
</template>
