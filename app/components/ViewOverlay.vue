<script setup lang="ts">
import { computed } from 'vue'
import type { FieldMode } from '../render/scene'
import { useSim } from '../composables/useSim'

const { mode, maxWind, showWind, showClouds, fullbright } = useSim()

const MODES: { id: FieldMode, label: string }[] = [
  { id: 'elevation', label: 'Terrain' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'wind', label: 'Wind speed' },
  { id: 'pressure', label: 'Pressure' }
]

/** The streamline ramp is stretched over the band of wind actually present, so the
 *  legend has to say what its ends are currently worth. */
const CALM_CUTOFF = 0.05
const ticks = computed(() => {
  const hi = maxWind.value
  const lo = hi * CALM_CUTOFF
  return [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(lo + (hi - lo) * f))
})
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-3">
    <div
      v-if="showWind"
      class="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#0b0e16]/90 px-3 py-1.5 backdrop-blur"
    >
      <span class="font-mono text-[10px] uppercase tracking-wider text-white/40">wind</span>
      <div
        class="h-1.5 w-40 rounded-full"
        style="background: linear-gradient(90deg,
          rgb(26,36,87) 0%,
          rgb(26,158,209) 30%,
          rgb(148,242,219) 55%,
          rgb(255,194,82) 78%,
          rgb(255,237,224) 100%)"
      />
      <div class="flex gap-2 font-mono text-[10px] tabular-nums text-white/45">
        <span
          v-for="(t, i) in ticks"
          :key="i"
        >{{ t }}</span>
      </div>
      <span class="font-mono text-[10px] text-white/30">m/s</span>
    </div>

    <div class="pointer-events-auto flex items-center gap-2">
      <div class="flex overflow-hidden rounded-full border border-white/10 bg-[#0b0e16]/90 backdrop-blur">
        <button
          v-for="m in MODES"
          :key="m.id"
          class="px-3.5 py-1.5 text-[11px]"
          :class="mode === m.id ? 'bg-emerald-500/25 text-emerald-200' : 'text-white/55 hover:bg-white/10'"
          @click="mode = m.id"
        >
          {{ m.label }}
        </button>
      </div>

      <button
        class="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b0e16]/90 px-3.5 py-1.5 text-[11px] backdrop-blur"
        :class="showWind ? 'text-emerald-200' : 'text-white/45 hover:text-white/70'"
        :title="showWind ? 'Hide the wind streamlines' : 'Show the wind streamlines'"
        @click="showWind = !showWind"
      >
        <span class="font-mono text-[12px] leading-none">{{ showWind ? '≋' : '≁' }}</span>
        Streamlines
      </button>

      <button
        class="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b0e16]/90 px-3.5 py-1.5 text-[11px] backdrop-blur"
        :class="showClouds ? 'text-emerald-200' : 'text-white/45 hover:text-white/70'"
        :title="showClouds ? 'Stop emphasising the clouds' : 'Emphasise the cloud deck'"
        @click="showClouds = !showClouds"
      >
        <span class="font-mono text-[12px] leading-none">☁</span>
        Highlight
      </button>

      <button
        class="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b0e16]/90 px-3.5 py-1.5 text-[11px] backdrop-blur"
        :class="fullbright ? 'text-amber-200' : 'text-white/45 hover:text-white/70'"
        title="Light every face equally, ignoring the star — useful for looking at the whole planet at once"
        @click="fullbright = !fullbright"
      >
        <span class="font-mono text-[12px] leading-none">{{ fullbright ? '☀' : '◐' }}</span>
        Fullbright
      </button>
    </div>
  </div>
</template>
