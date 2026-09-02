<script setup lang="ts">
const props = withDefaults(defineProps<{
  trigger?: 'click' | 'hover'
  // Teleports the content to <body> and positions it from the trigger's own screen rect instead of
  // relying on this component's `position: relative` wrapper. Needed wherever the trigger sits
  // inside a table's overflow-x-auto wrapper (SlimTable) - that wrapper clips any popover that
  // opens near the table's edge, since the content would otherwise be a positioned descendant of
  // it. Off by default: every other Popover already positions fine relative to its own trigger.
  teleport?: boolean
  placement?: 'bottom-start' | 'bottom-end' | 'top-end'
}>(), {
  teleport: false,
  placement: 'bottom-start',
})

const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)
const teleportStyle = ref<Record<string, string>>({})
let hoverTimeout: ReturnType<typeof setTimeout> | null = null

const isClick = computed(() => (props.trigger ?? 'click') === 'click')

const updatePosition = () => {
  if (!props.teleport) {return}
  const rect = triggerEl.value?.getBoundingClientRect()
  if (!rect) {return}
  if (props.placement === 'top-end') {
    teleportStyle.value = {
      bottom: `${window.innerHeight - rect.top + 8}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }
  else if (props.placement === 'bottom-end') {
    teleportStyle.value = {
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }
  else {
    teleportStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    }
  }
}

function onTriggerClick() {
  if (isClick.value) {
    open.value = !open.value
    if (open.value) {nextTick(updatePosition)}
  }
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
    if (props.teleport) {nextTick(updatePosition)}
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
    if (props.teleport) {
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
    }
  }
  else {
    document.removeEventListener('keydown', onKeydown)
    if (props.teleport) {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }
})

onBeforeUnmount(() => {
  if (hoverTimeout) { clearTimeout(hoverTimeout) }
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})
</script>

<template>
  <div class="relative">
    <div
      ref="triggerEl"
      @click="onTriggerClick"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <slot name="trigger" />
    </div>

    <Teleport v-if="teleport" to="body">
      <div
        v-if="open"
        class="fixed z-[600]"
        :style="teleportStyle"
        @mouseenter="cancelClose"
        @mouseleave="scheduleClose"
      >
        <slot name="content" />
      </div>
      <div v-if="open && isClick" class="fixed inset-0 z-[590]" @click="close" />
    </Teleport>
    <template v-else>
      <div
        v-if="open"
        @mouseenter="cancelClose"
        @mouseleave="scheduleClose"
      >
        <slot name="content" />
      </div>

      <div v-if="open && isClick" class="fixed inset-0 z-10" @click="close" />
    </template>
  </div>
</template>
