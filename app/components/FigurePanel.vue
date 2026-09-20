<script setup lang="ts">
import { computed } from 'vue'
import { useSim } from '../composables/useSim'

const { figure, laws } = useSim()

const rows = computed(() => {
  const f = figure.value
  if (!f) return []
  return [
    { k: 'Flattening  f', v: f.flatteningInverse > 9999 ? 'sphere' : `1 / ${f.flatteningInverse.toFixed(0)}`, accent: true },
    { k: 'Polar bulge', v: `${f.bulgeKm.toFixed(1)} km`, accent: true },
    { k: 'Equilibrium tide  ζ', v: `${f.peakTideKm.toFixed(1)} km`, accent: true },
    { k: 'Rot. parameter  m', v: f.rotParam.toExponential(2) },
    { k: 'Equatorial R', v: `${f.equatorialKm.toFixed(0)} km` },
    { k: 'Polar R', v: `${f.polarKm.toFixed(0)} km` },
    { k: 'Surface gravity', v: `${f.gravity.toFixed(2)} m/s²` },
    {
      k: 'Hill separation Δ',
      v: Number.isFinite(f.hill) ? f.hill.toFixed(2) : '—',
      warn: Number.isFinite(f.hill) && f.hill < 3.46
    }
  ]
})
</script>

<template>
  <div
    v-if="figure"
    class="w-[250px] rounded-lg border border-white/10 bg-[#0b0e16]/95 p-3 shadow-xl backdrop-blur"
  >
    <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
      Figure of the planet
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
          :class="row.warn ? 'text-rose-400' : row.accent ? 'text-orange-300' : 'text-white/85'"
        >
          {{ row.v }}
        </dd>
      </div>
    </dl>

    <div
      v-if="figure.escaped.length"
      class="mt-2 rounded bg-rose-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-rose-300"
    >
      Left the system: {{ figure.escaped.join(', ') }}. Two moons stay bound only while
      their Hill separation Δ is above 2√3 ≈ 3.46. Use “Relaunch moons” to restore them.
    </div>

    <div class="mt-2 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/30">
      The rocky body gradually approaches its equilibrium ellipsoid over {{ laws.shapeRelaxationDays }} days.
      Radii and flattening show its current shape; the equilibrium tide shows the forcing.
    </div>
  </div>
</template>
