<script setup lang="ts">
import { ref } from 'vue'
import { useSim } from '../composables/useSim'

const {
  paused, speed, meanTemp, maxWind, unstable,
  clock, historyReach, rewindLimit, notice, fastSeek, seekTarget,
  exportJson, importJson, goToDay
} = useSim()

const fileInput = ref<HTMLInputElement | null>(null)
const flash = ref('')
const jumpDay = ref('')

const SPEEDS = [-4, -1, 0.25, 1, 4, 16]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function doExport() {
  const blob = new Blob([exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `universe-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  flash.value = 'exported'
  setTimeout(() => (flash.value = ''), 1600)
}

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const ok = importJson(await f.text())
  flash.value = ok ? 'imported' : 'import failed'
  setTimeout(() => (flash.value = ''), 2200)
  ;(e.target as HTMLInputElement).value = ''
}

function doJump() {
  const d = Number(jumpDay.value)
  if (!Number.isFinite(d) || d < 0) return
  goToDay(d)
  jumpDay.value = ''
}
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0b0e16] px-3">
    <div class="flex items-center gap-2 pr-1">
      <div class="size-2 rounded-full bg-orange-400" />
      <span class="text-[13px] font-semibold tracking-wide text-white/90">Storm Clusters</span>
    </div>

    <div class="flex items-center gap-1">
      <button
        class="rounded px-2.5 py-1 text-[12px]"
        :class="paused ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/80 hover:bg-white/10'"
        @click="seekTarget = null; paused = !paused"
      >
        {{ paused ? 'Resume' : 'Pause' }}
      </button>
      <div class="flex overflow-hidden rounded bg-white/5">
        <button
          v-for="s in SPEEDS"
          :key="s"
          class="px-1.5 py-1 text-[11px]"
          :class="speed === s
            ? (s < 0 ? 'bg-amber-500/30 text-amber-200' : 'bg-emerald-500/25 text-emerald-200')
            : 'text-white/55 hover:bg-white/10'"
          :title="s < 0 ? 'rewind through recorded history' : 'forward'"
          @click="speed = s"
        >
          {{ s < 0 ? `◀${-s}` : (s < 1 ? `×¼` : `×${s}`) }}
        </button>
      </div>
    </div>

    <div class="flex items-center gap-1.5 rounded bg-white/5 px-2 py-1">
      <span class="font-mono text-[12px] tabular-nums text-white/85">
        d{{ clock.day }} {{ pad(clock.hour) }}:{{ pad(clock.minute) }}
      </span>
    </div>

    <form
      class="flex items-center gap-1"
      @submit.prevent="doJump"
    >
      <input
        v-model="jumpDay"
        type="number"
        min="0"
        step="1"
        placeholder="go to day"
        class="w-[86px] rounded bg-white/5 px-2 py-1 font-mono text-[11px] text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
      >
      <button
        type="submit"
        class="rounded bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
      >
        Go
      </button>
    </form>

    <label
      class="flex shrink-0 items-center gap-1 text-[11px] text-white/65"
      title="Fast jumps preserve global evolution and approximate destination weather. Turn off for full weather replay."
    >
      <input
        v-model="fastSeek"
        type="checkbox"
      >
      Fast jump
    </label>

    <div class="ml-auto hidden items-center gap-3 font-mono text-[11px] tabular-nums text-white/40 xl:flex">
      <span>T̄ {{ (meanTemp - 273.15).toFixed(0) }}°C</span>
      <span>v<sub>max</sub> {{ maxWind.toFixed(0) }} m/s</span>
    </div>

    <div class="flex items-center gap-1">
      <span
        v-if="flash"
        class="text-[11px] text-emerald-300"
      >{{ flash }}</span>
      <button
        class="rounded bg-white/5 px-2.5 py-1 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
        @click="fileInput?.click()"
      >
        Import
      </button>
      <button
        class="rounded bg-white/5 px-2.5 py-1 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
        @click="doExport()"
      >
        Export
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="onFile"
      >
    </div>
  </header>

  <div
    v-if="unstable"
    class="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-200"
  >
    <span class="font-semibold">Universe destabilised.</span>
    <span class="text-amber-200/70">
      The solver produced a non-finite value and paused. The law most likely responsible is
      <code class="font-mono text-amber-100">{{ unstable }}</code>. Move it back toward its default and resume.
    </span>
    <button
      class="ml-auto rounded bg-amber-500/20 px-2 py-0.5 text-[11px] hover:bg-amber-500/30"
      @click="unstable = null; paused = false"
    >
      Dismiss
    </button>
  </div>

  <div
    v-else-if="rewindLimit !== null"
    class="flex shrink-0 items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[12px] text-sky-200"
  >
    <span class="font-semibold">End of recorded history.</span>
    <span class="text-sky-200/70">
      The atmosphere is dissipative — it cannot be integrated backwards, so rewinding replays stored
      snapshots, and the ring only reaches back to
      <span class="font-mono">day {{ historyReach ? historyReach.fromDay.toFixed(2) : '0' }}</span>.
      Use “go to day” to replay from the beginning instead.
    </span>
    <button
      class="ml-auto rounded bg-sky-500/20 px-2 py-0.5 text-[11px] hover:bg-sky-500/30"
      @click="rewindLimit = null; speed = 1; paused = false"
    >
      Dismiss
    </button>
  </div>

  <div
    v-else-if="notice"
    class="flex shrink-0 items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-white/70"
  >
    <span>{{ notice }}</span>
    <button
      class="ml-auto rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20"
      @click="notice = null"
    >
      Dismiss
    </button>
  </div>
</template>
