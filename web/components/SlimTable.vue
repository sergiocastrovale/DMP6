<template>
  <!--
    Both halves of this are load-bearing. `overflow-x-auto` alone does nothing while the table is
    only `w-full`: it can never exceed its container, so the scroll axis never engages and a wide
    column set (downloads: artist/release/type/source/status/updated/actions) silently compresses
    into unreadable slivers instead of scrolling. `min-w-max` lets the table take its natural width
    so the overflow is real. `overflow-y-hidden` clips only the axis that cannot overflow - clipping
    both would amputate the rightmost columns with no way to reach them.
  -->
  <div class="overflow-x-auto overflow-y-hidden rounded-xl border border-stone-100/6 bg-stone-900">
    <table class="w-full min-w-max text-base">
      <slot />
    </table>
  </div>
</template>
