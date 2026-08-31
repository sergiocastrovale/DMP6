<script setup lang="ts">
// Same shell as `default`, narrowed on entry: an icon-rail sidenav and no search topbar, because
// every Labs page is a full-width canvas rather than a list to filter. Doing it here rather than in
// each of the five pages keeps the enter/leave pair in one place - a page that forgot the leave
// half would strand the whole app in rail mode.
const { rail, show } = useChrome()

onMounted(rail)
onBeforeUnmount(show)
</script>

<template>
  <LayoutAppShell>
    <slot />
  </LayoutAppShell>
</template>
