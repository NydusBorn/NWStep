<script setup lang="ts">
import { computed } from 'vue'
import { compassOf } from '../sim/world'
import { useSim } from '../composables/useSim'

const { reading, select } = useSim()

const rows = computed(() => {
  const r = reading.value
  if (!r) return []
  return [
    { k: 'Wind speed', v: `${r.windSpeed.toFixed(0)} m/s`, accent: true },
    { k: 'Beaufort force', v: r.beaufort.toFixed(1), accent: true },
    { k: 'Wind heading', v: `${compassOf(r.windBearing)} · ${r.windBearing.toFixed(0)}°`, accent: true },
    { k: 'Temperature', v: `${(r.temperature - 273.15).toFixed(1)} °C` },
    { k: 'Pressure', v: `${r.pressure.toFixed(1)} hPa` },
    { k: 'Elevation', v: `${r.elevation.toFixed(2)} km` },
    { k: 'Figure offset', v: `${r.figureOffset >= 0 ? '+' : ''}${r.figureOffset.toFixed(2)} km` },
    { k: 'Roughness', v: r.roughness.toFixed(3) },
    {
      k: 'Cavern',
      v: r.cavern > 0.01 ? r.cavern.toFixed(2) : '—',
      accent: r.cavern > 0.01
    },
    { k: 'Insolation', v: `${(r.insolation * 100).toFixed(0)} %` },
    { k: 'Cloud', v: r.cloud > 0.01 ? `${(r.cloud * 100).toFixed(0)} %` : '—' },
    { k: 'Dust', v: r.dust > 0.01 ? `${(r.dust * 100).toFixed(0)} %` : '—' },
    { k: 'Ice fraction', v: r.iceFrac.toFixed(2) },
    {
      k: 'Charge',
      v: r.charge > 0.01 ? `${(r.charge * 100).toFixed(0)} %` : '—',
      warn: r.charge > 0.45
    },
    { k: 'Position', v: `${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}°` }
  ]
})
</script>

<template>
  <div
    v-if="reading"
    class="w-[250px] rounded-lg border border-white/10 bg-[#0b0e16]/95 p-3 shadow-xl backdrop-blur"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
        Probe · cell {{ reading.cell }}
      </span>
      <button
        class="text-white/30 hover:text-white/70"
        @click="select(null)"
      >
        ×
      </button>
    </div>

    <dl class="space-y-1">
      <div
        v-for="row in rows"
        :key="row.k"
        class="flex items-baseline justify-between gap-3"
      >
        <dt class="text-[11px] text-white/45">
          {{ row.k }}
        </dt>
        <dd
          class="font-mono text-[12px] tabular-nums"
          :class="row.warn ? 'text-amber-300' : row.accent ? 'text-emerald-300' : 'text-white/85'"
        >
          {{ row.v }}
        </dd>
      </div>
    </dl>

    <div class="mt-2 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/30">
      Figure offset is how far the hydrostatic bulge lifts or lowers this point. The yellow line
      on the marker points the way the wind is blowing.
    </div>
  </div>
</template>
