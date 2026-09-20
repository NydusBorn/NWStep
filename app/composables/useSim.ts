import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { clampLaws, defaultLaws, LAW_DEFS, TERRAIN_LAWS, type Laws } from '../sim/laws'
import {
  createWorld, regenerateTerrain, resetOrbits, resetHistory, readCell, readFigure,
  type World, type CellReading, type FigureReading
} from '../sim/world'
import { historySpan } from '../sim/history'
import { clockOf } from '../sim/units'
import type { FieldMode } from '../render/scene'

const STORAGE_KEY = 'stormclusters.v3'

/** Module-scope singleton. The world holds large typed arrays, so it lives in a
 *  shallowRef and is mutated in place -- wrapping it in a reactive proxy would put
 *  a Proxy in front of every Float32Array access in the hot loop. */
const laws = reactive<Laws>(defaultLaws())
const world = shallowRef<World | null>(null)
const seed = ref(20260919)
const tick = ref(0)
const paused = ref(true)
/** negative runs time backwards through the snapshot ring */
const speed = ref(1)
const mode = ref<FieldMode>('elevation')
const exaggeration = ref(5)
/** separate from relief: the tidal bulge is a different magnitude and deserves
 *  its own dial, because over-driving it makes the planet look like it is shaking */
const figureExaggeration = ref(2)
const showWind = ref(true)
const showClouds = ref(true)
const fullbright = ref(false)
/** chrome visibility: the planet is the point, so all of it can get out of the way */
const sidebarOpen = ref(true)
const panelsOpen = ref(true)
const selectedCell = ref<number | null>(null)
const reading = ref<CellReading | null>(null)
const figure = ref<FigureReading | null>(null)
const unstable = ref<string | null>(null)
const regenerating = ref(false)
const fps = ref(0)
const tps = ref(0)
const meanTemp = ref(0)
const maxWind = ref(0)
/** Bumped whenever the terrain mesh must be re-uploaded to the GPU. */
const terrainVersion = ref(0)
/** Tick the world is travelling toward, or null when free-running. */
const seekTarget = ref<number | null>(null)
const seekProgress = ref(0)
const fastSeek = ref(true)
const rewindLimit = ref<number | null>(null)
const notice = ref<string | null>(null)

let terrainTimer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let initialised = false

function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 4,
        seed: seed.value,
        laws: { ...laws },
        mode: mode.value,
        exaggeration: exaggeration.value,
        figureExaggeration: figureExaggeration.value,
        speed: speed.value,
        showWind: showWind.value,
        showClouds: showClouds.value,
        fullbright: fullbright.value,
        sidebarOpen: sidebarOpen.value,
        panelsOpen: panelsOpen.value
      }))
    } catch { /* storage may be unavailable; the sim does not depend on it */ }
  }, 400)
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const save = JSON.parse(raw) as {
      v?: number
      seed?: number
      laws?: Laws
      mode?: FieldMode
      exaggeration?: number
      figureExaggeration?: number
      speed?: number
      showWind?: boolean
      showClouds?: boolean
      fullbright?: boolean
      sidebarOpen?: boolean
      panelsOpen?: boolean
    }
    if (save.v !== 3 && save.v !== 4) return
    if (typeof save.seed === 'number') seed.value = save.seed
    if (save.laws) {
      const clean = clampLaws(save.laws)
      // Migrate only the old defaults; preserve deliberately customised laws.
      if (save.v === 3 && clean.dustSettling === 0.03) clean.dustSettling = 0.003
      if (save.v === 3 && clean.dustThreshold === 0.004) clean.dustThreshold = 0.002
      for (const d of LAW_DEFS) laws[d.key] = clean[d.key]!
    }
    if (save.mode) mode.value = save.mode
    if (typeof save.exaggeration === 'number') exaggeration.value = save.exaggeration
    if (typeof save.figureExaggeration === 'number') figureExaggeration.value = save.figureExaggeration
    if (typeof save.speed === 'number') speed.value = save.speed
    if (typeof save.showWind === 'boolean') showWind.value = save.showWind
    if (typeof save.showClouds === 'boolean') showClouds.value = save.showClouds
    if (typeof save.fullbright === 'boolean') fullbright.value = save.fullbright
    if (typeof save.sidebarOpen === 'boolean') sidebarOpen.value = save.sidebarOpen
    if (typeof save.panelsOpen === 'boolean') panelsOpen.value = save.panelsOpen
  } catch { /* a corrupt save must not stop the app from starting */ }
}

export function useSim() {
  if (!initialised && typeof window !== 'undefined') {
    initialised = true
    restore()
    world.value = createWorld(seed.value, { ...laws })
    tick.value = 0

    watch(laws, () => {
      const w = world.value
      if (!w) return
      const next = clampLaws({ ...laws })
      const rebuild = [...TERRAIN_LAWS].some(k => next[k] !== w.laws[k])
      w.laws = next
      w.air.unstable = null
      w.paused = false
      seekTarget.value = null
      resetHistory(w)
      unstable.value = null
      if (rebuild) scheduleTerrain()
      persist()
    }, { deep: true })
  }

  function scheduleTerrain() {
    regenerating.value = true
    if (terrainTimer) clearTimeout(terrainTimer)
    terrainTimer = setTimeout(() => {
      const w = world.value
      if (w) regenerateTerrain(w)
      if (w) resetHistory(w)
      regenerating.value = false
      terrainVersion.value++
    }, 320)
  }

  function rebuildWorld(newSeedValue = seed.value) {
    if (terrainTimer) clearTimeout(terrainTimer)
    regenerating.value = false
    seekTarget.value = null
    unstable.value = null
    seed.value = newSeedValue
    const w = createWorld(newSeedValue, { ...laws })
    world.value = w
    tick.value = 0
    selectedCell.value = null
    reading.value = null
    rewindLimit.value = null
    terrainVersion.value++
    persist()
    return w
  }

  function newSeed() {
    rebuildWorld(Math.floor(Math.random() * 1e9))
  }

  function resetLaws() {
    const d = defaultLaws()
    for (const k of Object.keys(d)) laws[k] = d[k]!
    const w = world.value
    if (w) {
      resetOrbits(w)
      scheduleTerrain()
    }
  }

  function relaunchMoons() {
    const w = world.value
    if (w) resetOrbits(w)
  }

  function refreshReading() {
    const w = world.value
    if (!w) return
    figure.value = readFigure(w)
    if (selectedCell.value === null) {
      reading.value = null
      return
    }
    reading.value = readCell(w, selectedCell.value)
  }

  function select(cell: number | null) {
    selectedCell.value = cell
    refreshReading()
  }

  /**
   * Jump to a target tick. Long forward jumps may approximate local weather;
   * older dates rebuild under the current laws. Arrival is always paused.
   */
  function goToTick(target: number) {
    const w = world.value
    if (!w || !Number.isFinite(target)) return
    const t = Math.max(0, Math.round(target))
    if (!Number.isSafeInteger(t)) {
      notice.value = 'That date is outside the supported simulation range.'
      return
    }
    if (t === w.tick) {
      seekTarget.value = null
      paused.value = true
      return
    }
    const span = historySpan(w.history)
    if (t < w.tick && (!span || t < span.from)) {
      rebuildWorld()
      notice.value = 'Rebuilding from day 0 under the current laws; this date is outside recorded history.'
    }
    seekTarget.value = t
    seekProgress.value = Math.abs(t - world.value!.tick)
    rewindLimit.value = null
    paused.value = true
  }

  function goToDay(day: number) {
    // Round into the requested day, never to the last tick of the previous day.
    const raw = day * laws.rotationPeriod!
    goToTick(Math.ceil(raw - Math.max(1, Math.abs(raw)) * Number.EPSILON * 4))
  }

  function exportJson(): string {
    return JSON.stringify({ v: 3, seed: seed.value, tick: tick.value, laws: { ...laws } }, null, 2)
  }

  function importJson(text: string): boolean {
    try {
      const parsed = JSON.parse(text) as { seed?: number, laws?: Laws }
      if (!parsed.laws) return false
      const clean = clampLaws(parsed.laws)
      for (const d of LAW_DEFS) laws[d.key] = clean[d.key]!
      rebuildWorld(typeof parsed.seed === 'number' ? parsed.seed : seed.value)
      return true
    } catch {
      return false
    }
  }

  function clearHistoryNow() {
    const w = world.value
    if (w) resetHistory(w)
  }

  watch([showWind, showClouds, fullbright, sidebarOpen, panelsOpen, mode, exaggeration, figureExaggeration], persist)

  const clock = computed(() => clockOf(tick.value, laws))
  const historyReach = computed(() => {
    const w = world.value
    if (!w) return null
    const span = historySpan(w.history)
    if (!span) return null
    return { fromTick: span.from, fromDay: span.from / laws.rotationPeriod! }
  })

  return {
    laws, world, seed, tick, paused, speed, mode, exaggeration, figureExaggeration, showWind, showClouds, fullbright,
    sidebarOpen, panelsOpen,
    selectedCell, reading, figure, unstable, regenerating, fps, tps, meanTemp, maxWind,
    terrainVersion, seekTarget, seekProgress, fastSeek, rewindLimit, notice, clock, historyReach,
    select, refreshReading, newSeed, resetLaws, relaunchMoons, exportJson, importJson,
    goToTick, goToDay, clearHistoryNow, persist
  }
}
