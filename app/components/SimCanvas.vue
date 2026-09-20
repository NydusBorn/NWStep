<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PlanetScene } from '../render/scene'
import { FrameLimiter } from '../render/frameLimiter'
import { stepWorld, seek, toMetresPerSecond } from '../sim/world'
import { createFastForward, advanceFastForward, interruptFastForward, type FastForward } from '../sim/fastForward'
import { mulberry32 } from '../sim/noise'
import { useSim } from '../composables/useSim'
import FpsControl from './FpsControl.vue'

const {
  world, tick, paused, speed, mode, exaggeration, figureExaggeration, showWind, showClouds, fullbright,
  maxFps, renderScale, displayHz, gpuName,
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
  scene.setRenderScale(renderScale.value)
  scene.rebuildTerrainGeometry()
  scene.refreshField()
  resize()
  readGpuInfo()
  // dev-only handle so the scene can be poked from the console
  if (import.meta.dev) (window as unknown as Record<string, unknown>).__sim = { scene, world }
}

function resize() {
  if (!scene || !host.value) return
  const r = host.value.getBoundingClientRect()
  scene.resize(Math.max(1, r.width), Math.max(1, r.height))
}

/** The driver string is the difference between “this machine cannot draw faster”
 *  and “this session is not allowed to present faster”, so the readout shows it. */
function readGpuInfo() {
  if (!scene) return
  try {
    const gl = scene.renderer.getContext() as WebGLRenderingContext
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    gpuName.value = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER))
  } catch {
    gpuName.value = ''
  }
}

/** Decides which display refreshes are worth rendering, and measures the refresh
 *  the browser is pacing by. Skipped time is carried into the next frame, so a
 *  ceiling never changes how fast the world runs. */
const limiter = new FrameLimiter()

let fpsAcc = 0
let tickAcc = 0
let secAcc = 0
/** Both start due, so the first frame paints a field and a readout rather than a gap. */
let fieldAcc = FIELD_REFRESH_MS
let readoutAcc = READOUT_REFRESH_MS
let stepAcc = 0

/** Simulation ticks per second of wall clock at speed x1. Fixed, so the world
 *  runs at the same pace on a 60 Hz and a 240 Hz display. */
const TICK_HZ = 60
/** How often the field colours are re-uploaded, and how often the probe readout and
 *  the summary figures are recomputed. Milliseconds rather than "every Nth frame":
 *  counting frames tied both to the display, so the same world redrew its field at
 *  15 Hz on a 60 Hz panel and 8 Hz in a 32 Hz Remote Desktop session — the colours
 *  lagged the simulation for a reason no setting in the app explained. */
const FIELD_REFRESH_MS = 66
const READOUT_REFRESH_MS = 200
/** Share of each frame's wall-clock time the solver may spend, leaving the rest for
 *  rendering and input. A *share* rather than a fixed per-frame budget is what keeps
 *  the world's pace off the frame rate: a 32 fps Remote Desktop session has 31 ms
 *  frames and gets 15 ms of solving each, a 64 fps display has 16 ms frames and gets
 *  7.8 ms each — half a second of simulation per wall-clock second either way. The
 *  fixed 6 ms it replaces spent 6 ms *per frame*, so halving the frame rate halved
 *  the tick rate, and ×16 over RDP ran at a sixth of the speed it does locally. */
const SIM_BUDGET_SHARE = 0.5
/** Floor, so even a pathological frame advances the world rather than stalling it. */
const SIM_BUDGET_MIN_MS = 4
/** Ceiling on a single frame's solver time. Deliberately high enough that it is a
 *  sanity bound rather than a governor: it must not bite in the working range, or it
 *  would put the frame rate back into the tick rate through the back door. At 24 ms
 *  it clamped everything below ~21 fps, so an 8 fps session ran the world at a third
 *  of the speed a 32 fps one did. The share already guarantees the browser half of
 *  every frame whatever its length, so this only bounds the worst single frame. */
const SIM_BUDGET_MAX_MS = 50
/** How much unsimulated wall-clock time may be owed before the rest is written off.
 *  Never less than the frame just seen, or a slow display would discard time the
 *  solver was perfectly able to run. */
const MAX_BACKLOG_MS = 100

function simBudgetMs(dtMs: number): number {
  return Math.min(SIM_BUDGET_MAX_MS, Math.max(SIM_BUDGET_MIN_MS, dtMs * SIM_BUDGET_SHARE))
}
let fastJob: FastForward | null = null
let activeTarget: number | null = null
let activeWorld = world.value

function advance(dtMs: number) {
  const w = world.value
  if (!w) return
  const budgetMs = simBudgetMs(dtMs)

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
      ? { done: advanceFastForward(w, fastJob, budgetMs), reachable: true }
      : seek(w, seekTarget.value, budgetMs)
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
  stepAcc = Math.min(Math.max(MAX_BACKLOG_MS, dtMs), stepAcc + dtMs)
  if (stepAcc < stepMs) return

  if (speed.value > 0) {
    const deadline = performance.now() + budgetMs
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
    const res = seek(w, w.tick - n, budgetMs)
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
  const frame = limiter.read(now)
  if (!frame) return
  const { dtMs } = frame

  const w = world.value
  if (w && scene) {
    advance(dtMs)

    if (w.air.unstable) {
      unstable.value = w.air.unstable
      paused.value = true
    }
    tick.value = w.tick

    fieldAcc += dtMs
    if (fieldAcc >= FIELD_REFRESH_MS) {
      fieldAcc = 0
      scene.refreshField()
    }
    readoutAcc += dtMs
    if (readoutAcc >= READOUT_REFRESH_MS) {
      readoutAcc = 0
      refreshReading()
      if (selectedCell.value !== null) scene.setMarker(selectedCell.value)
      meanTemp.value = w.air.meanTemp
      maxWind.value = toMetresPerSecond(w.air.maxSpeed)
      windStreams.value = scene.windStreamCount
    }
    scene.render(dtMs, !paused.value && seekTarget.value === null)
  }

  fpsAcc++
  secAcc += dtMs
  if (secAcc >= 1000) {
    fps.value = Math.round((fpsAcc * 1000) / secAcc)
    tps.value = Math.round((tickAcc * 1000) / secAcc)
    displayHz.value = Math.round(limiter.displayHz)
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
watch(maxFps, v => limiter.setMaxFps(v), { immediate: true })
watch(renderScale, v => scene?.setRenderScale(v))
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
    <div class="absolute bottom-10 left-3 flex flex-col items-start gap-1">
      <FpsControl />
      <div
        class="pointer-events-none rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-emerald-200"
        data-testid="performance"
      >
        {{ fps }} FPS · {{ tps }} {{ seekTarget !== null ? 'jump ticks/s' : 'TPS' }}
        · {{ windStreams }} streams
      </div>
    </div>
  </div>
</template>
