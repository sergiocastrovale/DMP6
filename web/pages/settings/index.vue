<script setup lang="ts">
const { isAdmin } = useAuth()
const router = useRouter()

if (!isAdmin.value) {
  router.replace('/')
} else {
  router.replace('/settings/library')
}
</script>

<template>
  <div />
</template>
