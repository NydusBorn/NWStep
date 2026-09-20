<script setup lang="ts">
import SimTopBar from '../components/SimTopBar.vue'
import LawSidebar from '../components/LawSidebar.vue'
import SimCanvas from '../components/SimCanvas.vue'
import CellInspector from '../components/CellInspector.vue'
import FigurePanel from '../components/FigurePanel.vue'
import ViewOverlay from '../components/ViewOverlay.vue'
import { useSim } from '../composables/useSim'

const { panelsOpen } = useSim()

useHead({ title: 'Storm Clusters — law sandbox' })
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-[#05070d] text-white">
    <SimTopBar />
    <div class="flex min-h-0 flex-1">
      <LawSidebar />
      <main class="relative min-w-0 flex-1">
        <ClientOnly>
          <SimCanvas />
          <template #fallback>
            <div class="flex h-full items-center justify-center text-[12px] text-white/40">
              building the planet…
            </div>
          </template>
        </ClientOnly>
        <div class="absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col items-end gap-2">
          <button
            class="shrink-0 rounded-full border border-white/10 bg-[#0b0e16]/90 px-2.5 py-1 text-[11px] text-white/50 backdrop-blur hover:bg-white/10 hover:text-white/80"
            :title="panelsOpen ? 'Minimise the readouts' : 'Show the readouts'"
            @click="panelsOpen = !panelsOpen"
          >
            {{ panelsOpen ? '» readouts' : '« readouts' }}
          </button>
          <div
            v-if="panelsOpen"
            class="flex min-h-0 flex-col gap-2 overflow-y-auto"
          >
            <CellInspector />
            <FigurePanel />
          </div>
        </div>
        <ViewOverlay />
      </main>
    </div>
  </div>
</template>
