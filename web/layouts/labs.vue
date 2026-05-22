<template>
  <div class="flex flex-col h-screen bg-bg text-ink font-sans antialiased">
    <div class="flex-1 overflow-hidden flex flex-col">
      <LabsHeader />

      <main class="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>

    <PlayerAudioPlayer />
  </div>
</template>
