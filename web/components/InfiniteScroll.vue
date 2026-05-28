<script setup lang="ts">
const props = withDefaults(defineProps<{
  margin?: string
}>(), {
  margin: '400px',
})

const emit = defineEmits<{
  load: []
}>()

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        emit('load')
      }
    },
    { rootMargin: props.margin },
  )

  watch(sentinel, (el, _, onCleanup) => {
    if (el) {
      observer!.observe(el)
    }
    onCleanup(() => observer?.disconnect())
  }, { immediate: true })
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div ref="sentinel" />
</template>
