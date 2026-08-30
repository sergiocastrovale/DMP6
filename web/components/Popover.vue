<script setup lang="ts">
const props = defineProps<{
  trigger?: 'click' | 'hover'
}>()

const open = ref(false)
let hoverTimeout: ReturnType<typeof setTimeout> | null = null

const isClick = computed(() => (props.trigger ?? 'click') === 'click')

function onTriggerClick() {
  if (isClick.value) { open.value = !open.value }
}

function scheduleClose() {
  if (!isClick.value) {
    hoverTimeout = setTimeout(() => { open.value = false }, 100)
  }
}

function cancelClose() {
  if (!isClick.value) {
    if (hoverTimeout) { clearTimeout(hoverTimeout) }
    open.value = true
  }
}

function close() {
  open.value = false
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close()
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', onKeydown)
  }
  else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (hoverTimeout) { clearTimeout(hoverTimeout) }
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="relative">
    <div
      @click="onTriggerClick"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <slot name="trigger" />
    </div>

    <div
      v-if="open"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <slot name="content" />
    </div>

    <div v-if="open && isClick" class="fixed inset-0 z-10" @click="close" />
  </div>
</template>
