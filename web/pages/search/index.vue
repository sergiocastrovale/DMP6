<script setup lang="ts">
definePageMeta({
  middleware: (to) => navigateTo({ path: '/search/artists', query: to.query }),
})
</script>
