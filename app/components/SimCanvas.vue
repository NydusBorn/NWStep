<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PlanetScene } from '../render/scene'
import { stepWorld, seek, toMetresPerSecond } from '../sim/world'
import { createFastForward, advanceFastForward, interruptFastForward, type FastForward } from '../sim/fastForward'
import { mulberry32 } from '../sim/noise'
import { useSim } from '../composables/useSim'

const {
  world, tick, paused, speed, mode, exaggeration, figureExaggeration, showWind, showClouds, fullbright,
  selectedCell, unstable, fps, tps, meanTemp, maxWind, terrainVersion,
  seekTarget, seekProgress, fastSeek, rewindLimit, notice,
  select, refreshReading
} = useSim()

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const windStreams = ref(0)
let scene: PlanetScene | null = null
let raf = 0
let observer: ResizeObserver | null = null
let downX = 0, downY = 0

function buildScene() {
  const w = world.value
  if (!w || !canvas.value || !host.value) return
  scene?.dispose()
  scene = new PlanetScene(canvas.value, w, mulberry32(w.seed ^ 0x2f6e2b1))
  scene.mode = mode.value
  scene.exaggeration = exaggeration.value
  scene.figureExaggeration = figureExaggeration.value
  scene.showWind = showWind.value
  scene.showClouds = showClouds.value
  scene.fullbright = fullbright.value
  scene.rebuildTerrainGeometry()
  scene.refreshField()
  resize()
  // dev-only handle so the scene can be poked from the console
  if (import.meta.dev) (window as unknown as Record<string, unknown>).__sim = { scene, world }
}

function resize() {
  if (!scene || !host.value) return
  const r = host.value.getBoundingClientRect()
  scene.resize(Math.max(1, r.width), Math.max(1, r.height))
}

let lastTime = 0
let frames = 0
let fpsAcc = 0
let tickAcc = 0
let secAcc = 0
let stepAcc = 0

/** Simulation ticks per second of wall clock at speed x1. Fixed, so the world
 *  runs at the same pace on a 60 Hz and a 240 Hz display. */
const TICK_HZ = 60
/** Leave time for rendering and input, regardless of the requested playback rate. */
const SIM_BUDGET_MS = 6
let fastJob: FastForward | null = null
let activeTarget: number | null = null
let activeWorld = world.value

function advance(dtMs: number) {
  const w = world.value
  if (!w) return

  // a requested jump takes priority over normal playback
  if (seekTarget.value !== null) {
    if (activeTarget !== seekTarget.value || activeWorld !== w) {
      if (fastJob && activeWorld === w) interruptFastForward(w, fastJob)
      activeTarget = seekTarget.value
      activeWorld = w
      fastJob = fastSeek.value && seekTarget.value - w.tick > 2 * w.laws.rotationPeriod!
        ? createFastForward(w, seekTarget.value)
        : null
      if (fastJob) notice.value = 'Fast jump: global evolution is preserved; destination weather is approximated. Rewind history restarts on arrival.'
    }
    const from = w.tick
    const res = fastJob
      ? { done: advanceFastForward(w, fastJob, SIM_BUDGET_MS), reachable: true }
      : seek(w, seekTarget.value, SIM_BUDGET_MS)
    tickAcc += Math.abs(w.tick - from)
    const remaining = Math.abs(seekTarget.value - w.tick)
    seekProgress.value = remaining
    if (res.done || !res.reachable || w.paused) {
      seekTarget.value = null
      paused.value = true
      activeTarget = null
      fastJob = null
      stepAcc = 0
      scene?.refreshField()
      refreshReading()
    }
    return
  }
  if (fastJob && activeWorld === w) interruptFastForward(w, fastJob)
  activeTarget = null
  fastJob = null

  if (paused.value || w.paused) {
    stepAcc = 0
    return
  }

  const mag = Math.abs(speed.value) || 1
  const stepMs = 1000 / (TICK_HZ * mag)
  stepAcc = Math.min(100, stepAcc + dtMs)
  if (stepAcc < stepMs) return

  if (speed.value > 0) {
    const deadline = performance.now() + SIM_BUDGET_MS
    let n = 0
    while (stepAcc >= stepMs) {
      stepWorld(w)
      stepAcc -= stepMs
      n++
      if (w.paused || performance.now() >= deadline) break
    }
    rewindLimit.value = null
    tickAcc += n
  } else {
    // One seek for the whole frame, not one per tick: it restores the nearest
    // snapshot and replays at most a stride's worth of ticks either way.
    const from = w.tick
    const n = Math.min(w.tick, Math.floor(stepAcc / stepMs))
    stepAcc = 0
    const res = seek(w, w.tick - n, SIM_BUDGET_MS)
    if (!res.reachable) {
      rewindLimit.value = w.tick
      paused.value = true
    } else {
      tickAcc += Math.abs(w.tick - from)
    }
  }
}

function loop(now: number) {
  raf = requestAnimationFrame(loop)
  const dtMs = lastTime ? now - lastTime : 16.7
  lastTime = now
  const dtFrames = Math.min(3, Math.max(0.2, dtMs / 16.667))

  const w = world.value
  if (w && scene) {
    advance(dtMs)

    if (w.air.unstable) {
      unstable.value = w.air.unstable
      paused.value = true
    }
    tick.value = w.tick

    if (frames % 4 === 0) scene.refreshField()
    if (frames % 12 === 0) {
      refreshReading()
      if (selectedCell.value !== null) scene.setMarker(selectedCell.value)
      meanTemp.value = w.air.meanTemp
      maxWind.value = toMetresPerSecond(w.air.maxSpeed)
      windStreams.value = scene.windStreamCount
    }
    scene.render(dtFrames, !paused.value && seekTarget.value === null)
  }

  frames++
  fpsAcc++
  secAcc += dtMs
  if (secAcc >= 1000) {
    fps.value = Math.round((fpsAcc * 1000) / secAcc)
    tps.value = Math.round((tickAcc * 1000) / secAcc)
    fpsAcc = 0
    tickAcc = 0
    secAcc = 0
  }
}

function onPointerDown(e: PointerEvent) {
  downX = e.clientX
  downY = e.clientY
}

/** Right-click clears the probe marker. Guarded by the same drag threshold as the
 *  left button, because OrbitControls pans on right-drag and a pan should not
 *  count as a click. */
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return
  select(null)
  scene?.setMarker(null)
}

function onPointerUp(e: PointerEvent) {
  if (!scene || !canvas.value) return
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return // it was a camera drag
  const r = canvas.value.getBoundingClientRect()
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1)
  const cell = scene.pick(ndcX, ndcY)
  select(cell)
  scene.setMarker(cell)
}

onMounted(() => {
  buildScene()
  observer = new ResizeObserver(resize)
  if (host.value) observer.observe(host.value)
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
  scene?.dispose()
  scene = null
})

watch(world, () => buildScene())
watch(terrainVersion, () => {
  scene?.rebuildTerrainGeometry()
  scene?.refreshField()
})
watch(mode, (m) => {
  if (!scene) return
  scene.mode = m
  scene.refreshField()
})
watch(exaggeration, (v) => {
  if (!scene) return
  scene.exaggeration = v
  scene.rebuildTerrainGeometry()
  if (selectedCell.value !== null) scene.setMarker(selectedCell.value)
})
watch(figureExaggeration, (v) => {
  if (scene) scene.figureExaggeration = v
})
watch(showWind, (v) => {
  if (scene) scene.showWind = v
})
watch(showClouds, (v) => {
  if (scene) scene.showClouds = v
})
watch(fullbright, (v) => {
  if (scene) scene.fullbright = v
})
watch(selectedCell, c => scene?.setMarker(c))
</script>

<template>
  <div
    ref="host"
    class="relative h-full w-full overflow-hidden bg-[#05060a]"
  >
    <canvas
      ref="canvas"
      class="block h-full w-full cursor-crosshair touch-none"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @contextmenu="onContextMenu"
    />
    <div
      v-if="seekTarget !== null"
      class="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-4"
    >
      <div class="rounded-full bg-black/70 px-4 py-1.5 font-mono text-[11px] text-emerald-300 backdrop-blur">
        travelling — {{ seekProgress }} ticks to go
      </div>
    </div>
    <div class="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-white/35">
      drag to orbit · scroll to zoom · click to probe · right-click to clear
    </div>
    <div
      class="pointer-events-none absolute bottom-10 left-3 rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-emerald-200"
      data-testid="performance"
    >
      {{ fps }} FPS · {{ tps }} {{ seekTarget !== null ? 'jump ticks/s' : 'TPS' }}
      · {{ windStreams }} streams
    </div>
  </div>
</template>
