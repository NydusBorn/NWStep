<script setup lang="ts">
import { computed, ref } from 'vue'
import { cappedRate } from '../render/frameLimiter'
import { useSim } from '../composables/useSim'

const { fps, maxFps, renderScale, displayHz, gpuName } = useSim()

const open = ref(false)

const CAPS = [30, 60, 120, 0]
const SCALES = [0.5, 0.75, 1]

function capText(v: number) {
  return v === 0 ? '∞' : `${v}`
}

/** What the ceiling allows on the display actually in use; 0 when it allows everything. */
const allowed = computed(() => cappedRate(displayHz.value, maxFps.value))

/** A session allowed far fewer frames than any monitor: say so, because no setting
 *  in this page can raise it and the measured number is not a bug to be found here. */
const sessionCapped = computed(() => displayHz.value > 0 && displayHz.value < 45)

/** Software GL drivers (RDP, WARP, llvmpipe) are a different limit from the session
 *  frame rate and need naming separately, because nothing here fixes them. */
const softwareGl = computed(() => /basic render|warp|llvmpipe|software|swiftshader/i.test(gpuName.value))
</script>

<template>
  <div class="relative">
    <div
      v-if="open"
      class="fixed inset-0 z-10"
      @click="open = false"
    />
    <button
      class="pointer-events-auto rounded border bg-[#0b0e16]/90 px-2 py-1 font-mono text-[10px] backdrop-blur"
      :class="maxFps > 0 ? 'border-emerald-400/30 text-emerald-200' : 'border-white/10 text-white/50 hover:text-white/75'"
      :title="`Frame-rate ceiling. Measured display refresh: ${displayHz ? `${displayHz.toFixed(0)} Hz` : 'unknown'}`"
      @click="open = !open"
    >
      <span class="text-white/35">cap</span> {{ capText(maxFps) }}
      <span class="text-white/25">·</span> {{ fps }} fps
      <span class="text-white/25">·</span> {{ displayHz ? `${displayHz.toFixed(0)} Hz` : '? Hz' }}
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-20 mb-1 w-[280px] rounded border border-white/10 bg-[#0b0e16]/95 p-2 font-mono text-[10px] leading-relaxed text-white/60 shadow-xl backdrop-blur"
      @keydown.esc="open = false"
    >
      <div class="mb-1 flex items-center gap-2">
        <span class="uppercase tracking-wider text-white/35">max fps</span>
        <div class="flex overflow-hidden rounded border border-white/10">
          <button
            v-for="c in CAPS"
            :key="c"
            class="px-2 py-0.5"
            :class="maxFps === c ? 'bg-emerald-500/25 text-emerald-200' : 'text-white/50 hover:bg-white/10'"
            :title="c === 0 ? 'Render every display refresh' : `Never render faster than ${c} fps`"
            @click="maxFps = c"
          >
            {{ capText(c) }}
          </button>
        </div>
      </div>

      <div class="mb-1.5 flex items-center gap-2">
        <span class="uppercase tracking-wider text-white/35">pixels</span>
        <div class="flex overflow-hidden rounded border border-white/10">
          <button
            v-for="s in SCALES"
            :key="s"
            class="px-2 py-0.5"
            :class="renderScale === s ? 'bg-emerald-500/25 text-emerald-200' : 'text-white/50 hover:bg-white/10'"
            title="Framebuffer size. Under 100% draws fewer pixels — the only way to gain frames when the session is fill-rate bound."
            @click="renderScale = s"
          >
            {{ Math.round(s * 100) }}%
          </button>
        </div>
      </div>

      <p
        v-if="allowed > 0"
        class="text-white/40"
      >
        {{ allowed.toFixed(0) }} fps on a {{ displayHz.toFixed(0) }} Hz display
      </p>

      <p
        v-if="sessionCapped"
        class="text-amber-200/70"
      >
        Nothing here can raise the {{ displayHz.toFixed(0) }} Hz this page is presented at. Windows caps a
        Remote Desktop session at 30 fps — raise “Configure display frame rate for RDP sessions”, or run
        this on the machine itself.
      </p>

      <p
        v-if="softwareGl"
        class="text-amber-200/70"
      >
        Drawing on a software renderer ({{ gpuName.slice(0, 40) }}): use “pixels” to trade detail for
        frame rate, or turn hardware acceleration on.
      </p>
    </div>
  </div>
</template>
