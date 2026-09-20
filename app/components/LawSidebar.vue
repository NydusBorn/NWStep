<script setup lang="ts">
import { ref } from 'vue'
import { LAW_GROUPS, lawsByGroup } from '../sim/laws'
import { tidalLockPeriod } from '../sim/world'
import { useSim } from '../composables/useSim'

const {
  laws, seed, exaggeration, figureExaggeration, regenerating, sidebarOpen,
  newSeed, resetLaws, relaunchMoons
} = useSim()
const groups = lawsByGroup()
const open = ref<Record<string, boolean>>(
  Object.fromEntries(LAW_GROUPS.map(g => [g, true]))
)
const expanded = ref<string | null>(null)

function snapToLock() {
  // exact, not rounded: a tick of error here shows up as the bulge slowly libating
  laws.rotationPeriod = Math.round(tidalLockPeriod(laws) * 100) / 100
}

function fmt(v: number, step: number): string {
  const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return v.toFixed(dp)
}
</script>

<template>
  <button
    v-if="!sidebarOpen"
    class="flex h-full w-9 shrink-0 cursor-pointer flex-col items-center gap-3 border-r border-white/10 bg-[#0b0e16] pt-3 text-white/45 hover:bg-white/5 hover:text-white/80"
    title="Show the laws"
    @click="sidebarOpen = true"
  >
    <span class="text-[13px] leading-none">»</span>
    <span class="text-[10px] font-semibold uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
      Laws
    </span>
  </button>

  <aside
    v-else
    class="flex h-full w-[330px] shrink-0 flex-col border-r border-white/10 bg-[#0b0e16]"
  >
    <div class="border-b border-white/10 px-4 py-3">
      <div class="flex items-start justify-between gap-2">
        <div class="text-[13px] font-semibold tracking-wide text-white/90">
          Laws of this universe
        </div>
        <button
          class="-mr-1 shrink-0 rounded px-1.5 py-0.5 text-[13px] leading-none text-white/40 hover:bg-white/10 hover:text-white/80"
          title="Minimise"
          @click="sidebarOpen = false"
        >
          «
        </button>
      </div>
      <p class="mt-1 text-[11px] leading-relaxed text-white/40">
        Nothing here is a setting. Each slider is a constant or an exponent inside a
        real equation in the solver. Change one and the world reorganises around it.
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <section
        v-for="g in LAW_GROUPS"
        :key="g"
        class="mb-3"
      >
        <button
          class="flex w-full items-center justify-between rounded px-1 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50 hover:text-white/80"
          @click="open[g] = !open[g]"
        >
          <span>{{ g }}</span>
          <span class="text-white/25">{{ open[g] ? '−' : '+' }}</span>
        </button>

        <div
          v-if="open[g]"
          class="space-y-3 pt-1"
        >
          <div
            v-for="d in groups[g]"
            :key="d.key"
            class="rounded-md bg-white/[0.03] px-2.5 py-2"
          >
            <div class="flex items-baseline justify-between gap-2">
              <button
                class="text-left text-[12px] text-white/80 hover:text-white"
                @click="expanded = expanded === d.key ? null : d.key"
              >
                {{ d.label }}
              </button>
              <span class="shrink-0 font-mono text-[12px] tabular-nums text-emerald-300">
                {{ fmt(laws[d.key]!, d.step) }}<span
                  v-if="d.unit"
                  class="ml-0.5 text-[10px] text-white/35"
                >{{ d.unit }}</span>
              </span>
            </div>

            <div class="mt-0.5 font-mono text-[10px] text-white/30">
              {{ d.formula }}
            </div>

            <input
              v-model.number="laws[d.key]"
              type="range"
              :min="d.min"
              :max="d.max"
              :step="d.step"
              class="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded bg-white/10 accent-emerald-400"
            >

            <p
              v-if="expanded === d.key"
              class="mt-1.5 text-[11px] leading-relaxed text-white/45"
            >
              {{ d.hint }}
            </p>
            <div class="mt-1 flex items-center gap-2">
              <span
                v-if="d.rebuildsTerrain"
                class="text-[10px] text-amber-400/50"
              >rebuilds terrain</span>
              <button
                v-if="d.key === 'rotationPeriod'"
                class="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20"
                title="Match the inner moon's orbital period, so the tidal bulge stops moving across the surface"
                @click="snapToLock()"
              >
                snap to tidal lock
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="mb-3">
        <div class="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
          View
        </div>
        <div class="space-y-3 rounded-md bg-white/[0.03] px-2.5 py-2">
          <div>
            <div class="flex items-baseline justify-between">
              <span class="text-[12px] text-white/80">Relief exaggeration</span>
              <span class="font-mono text-[12px] text-emerald-300">×{{ exaggeration }}</span>
            </div>
            <div class="mt-0.5 font-mono text-[10px] text-white/30">
              display only — physics uses true elevation
            </div>
            <input
              v-model.number="exaggeration"
              type="range"
              min="1"
              max="30"
              step="1"
              class="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded bg-white/10 accent-emerald-400"
            >
          </div>
          <div>
            <div class="flex items-baseline justify-between">
              <span class="text-[12px] text-white/80">Figure exaggeration</span>
              <span class="font-mono text-[12px] text-emerald-300">×{{ figureExaggeration }}</span>
            </div>
            <div class="mt-0.5 font-mono text-[10px] text-white/30">
              display only — the real bulge is a fraction of a percent
            </div>
            <input
              v-model.number="figureExaggeration"
              type="range"
              min="0"
              max="20"
              step="1"
              class="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded bg-white/10 accent-emerald-400"
            >
          </div>
        </div>
      </section>
    </div>

    <div class="border-t border-white/10 px-3 py-3">
      <div class="mb-2 flex items-center justify-between font-mono text-[10px] text-white/35">
        <span>seed {{ seed }}</span>
        <span
          v-if="regenerating"
          class="text-amber-400"
        >rebuilding terrain…</span>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          class="rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
          @click="newSeed()"
        >
          New world
        </button>
        <button
          class="rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
          @click="relaunchMoons()"
        >
          Relaunch moons
        </button>
        <button
          class="rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
          @click="resetLaws()"
        >
          Reset laws
        </button>
      </div>
    </div>
  </aside>
</template>
