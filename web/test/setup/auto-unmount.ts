import { afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// Without this, every mounted wrapper across the whole nuxt-project test run is left mounted
// forever - onUnmounted never fires, so every component with an interval/timeout-based cleanup
// (poll loops, toast auto-dismiss, tick timers) leaks a live timer for the rest of the run. Once
// enough real time passes (e.g. the integration project's Postgres testcontainer startup), one of
// those leaked timers fires a reactive update against a long-torn-down DOM tree and crashes with
// "Cannot read properties of null (reading 'insertBefore')" in a completely unrelated test file.
enableAutoUnmount(afterEach)
