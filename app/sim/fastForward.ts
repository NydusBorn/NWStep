import { stellarFlux } from './units'
import { createAir, stepAir } from './air'
import { createClouds } from './clouds'
import { clearHistory, record } from './history'
import { stepGlobals, stepWorld, type World } from './world'

export interface FastForward {
  target: number
  weatherStart: number
  prepared: boolean
}

/** Skip the expensive local weather history. Keep exactly the same global
 * integration as playback, then seed daily-mean climate and resolve the last
 * 24 weather ticks. This is an approximation, not a historical weather replay. */
export function createFastForward(world: World, target: number): FastForward {
  if (!Number.isSafeInteger(target) || target < world.tick) throw new RangeError('Invalid forward target')
  return { target, weatherStart: Math.max(world.tick, target - 24), prepared: false }
}

/** Make an interrupted jump a valid resumable world, with fresh local weather
 * and a checkpoint rather than stale weather attached to a future clock. */
export function interruptFastForward(world: World, job: FastForward): void {
  if (!job.prepared) prepareClimate(world)
  clearHistory(world.history)
  record(world.history, world, true)
}

function prepareClimate(world: World): void {
  const { grid } = world.sphere
  const { laws } = world
  world.air = createAir(grid)
  world.clouds = createClouds(grid, world.terrain, laws)
  // Annual/diurnal mean insolation: a cheap latitude-dependent climate baseline.
  // Weather at arrival is then driven by the actual destination sun/season.
  const sigma = 300 / 288 ** laws.emissionExponent!
  for (let i = 0; i < grid.count; i++) {
    // Include unresolved heat redistribution; a point pole must not be seeded
    // at 3 K merely because its annual-mean direct equinox flux is zero.
    const insol = 0.8 * Math.max(0, Math.cos(grid.lat[i]!)) / Math.PI + 0.2 * 0.25
    const absorbed = stellarFlux(laws) * (1 - laws.albedo!) * insol
    const equilibrium = (absorbed / (sigma * (1 - laws.greenhouse!))) ** (1 / laws.emissionExponent!)
    world.air.temp[i] = Math.max(3, Math.min(4000, equilibrium))
  }
  // Populate derived pressure/readouts without advancing time.
  stepAir(grid, world.terrain, world.caves, world.air, laws, world.tick, 0)
  world.paused = false
}

/** A wall-clock budget, so even a distant date never monopolises one frame. */
export function advanceFastForward(world: World, job: FastForward, budgetMs = 6): boolean {
  const deadline = performance.now() + budgetMs
  while (world.tick < job.weatherStart) {
    stepGlobals(world)
    if (performance.now() >= deadline) return false
  }
  if (!job.prepared) {
    prepareClimate(world)
    job.prepared = true
    if (performance.now() >= deadline) return false
  }
  while (world.tick < job.target) {
    stepWorld(world, false)
    if (world.paused || performance.now() >= deadline) return false
  }
  // The skipped interval has approximate weather, so don't advertise its sparse
  // endpoints as a continuous exact rewind history.
  clearHistory(world.history)
  record(world.history, world, true)
  return true
}
