<script setup lang="ts">
import { useSim } from '../composables/useSim'

const { sidebarOpen, panelsOpen } = useSim()
useHead({ title: 'NWStep — Planetary System' })
</script>

<template>
  <div class="flex h-dvh w-full overflow-hidden bg-neutral-950 text-white">
    <USidebar
      v-model:open="sidebarOpen"
      variant="inset"
      collapsible="offcanvas"
      side="left"
      :ui="{ container: 'h-full', body: 'min-h-0 overflow-hidden p-0', header: 'px-4' }"
    >
      <template #header>
        <UIcon
          name="i-lucide-orbit"
          class="size-8 text-primary"
        />
        <span class="font-semibold">NWStep</span>
        <UButton
          class="ml-auto"
          icon="i-lucide-panel-left-close"
          color="neutral"
          variant="ghost"
          aria-label="Hide laws"
          @click="sidebarOpen = false"
        />
      </template>
      <LawSidebar />
    </USidebar>
    <main class="m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-default shadow-sm ring ring-default lg:m-4 lg:peer-data-[state=expanded]:ms-0">
      <SimTopBar />
      <div class="min-h-0 flex-1 p-2 lg:p-4">
        <div class="relative h-full overflow-hidden rounded-lg bg-[#05070d]">
          <ClientOnly>
            <SimCanvas />
            <template #fallback>
              <div class="flex h-full items-center justify-center text-sm text-muted">
                Building the planet…
              </div>
            </template>
          </ClientOnly>
          <div class="absolute right-3 top-3 flex max-h-[calc(100%-8rem)] max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
            <UButton
              color="neutral"
              variant="soft"
              size="xs"
              :icon="panelsOpen ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'"
              :aria-expanded="panelsOpen"
              label="Readouts"
              @click="panelsOpen = !panelsOpen"
            />
            <div
              v-if="panelsOpen"
              class="flex min-h-0 flex-col gap-2 overflow-y-auto"
            >
              <CellInspector />
              <FigurePanel />
            </div>
          </div>
          <ViewOverlay />
        </div>
      </div>
    </main>
  </div>
</template>
