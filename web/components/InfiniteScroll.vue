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
let mutations: MutationObserver | null = null
let frame = 0

// An IntersectionObserver only reports threshold crossings: when a page appends and the sentinel is still
// inside the margin (a tall or 4K screen) no new event fires and loading would stall until the user scrolls.
// Observing again makes the browser deliver a fresh initial notification for the sentinel's current state.
const recheck = () => {
  if (frame || !observer || !sentinel.value) {
    return
  }
  frame = requestAnimationFrame(() => {
    frame = 0
    if (observer && sentinel.value) {
      observer.unobserve(sentinel.value)
      observer.observe(sentinel.value)
    }
  })
}

defineExpose({ recheck })

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
      const parent = el.parentElement
      if (parent) {
        mutations = new MutationObserver(recheck)
        mutations.observe(parent, { childList: true, subtree: true })
      }
    }
    onCleanup(() => {
      observer?.disconnect()
      mutations?.disconnect()
    })
  }, { immediate: true })
})

onUnmounted(() => {
  observer?.disconnect()
  mutations?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="sentinel" />
</template>
