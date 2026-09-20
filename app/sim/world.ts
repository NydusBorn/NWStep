import { buildSphere, type Sphere } from './icosphere'
import { createLife, prepareLife, finishLife, type Life } from './life'
import { generateTerrain, type Terrain } from './terrain'
import { generateCaves, type Caves } from './caves'
import { createClouds, stepClouds, type Clouds } from './clouds'
import { createAir, stepAir, sunDirection, effectiveTemp, type Air } from './air'
import { stepUpperAir } from './upperAir'
import { clampLaws, defaultLaws, type Laws } from './laws'
import { computeFigure, equilibriumStrain, relaxStrain, strainOffsetKm, type Figure } from './shape'
import { createHistory, record, findFrame, restore, clearHistory, type History } from './history'
import { beaufort, clockOf, orbitalPeriod, surfaceGravity, toMetresPerSecond, planetRadiusKm, orbitalGravity, type Clock } from './units'

export { toMetresPerSecond } from './units'

export interface Body {
  name: string
  mass: number
  radius: number
  color: number
  pos: [number, number, number]
  vel: [number, number, number]
  /** sampled orbit history as x, y, z, tick -- the tick is needed to draw the trail
   *  in the planet's co-rotating frame, where a locked moon stands still */
  trail: number[]
}

export interface World {
  /** names of bodies that left the system, so the UI can say so rather than
   *  silently losing a moon off the edge of the scene */
  escaped: string[]
  sphere: Sphere
  terrain: Terrain
  caves: Caves
  clouds: Clouds
  life: Life
  air: Air
  laws: Laws
  bodies: Body[]
  /** hydrostatic figure implied by the current laws and moon positions */
  figure: Figure
  /** Actual slowly evolving deformation, distinct from instantaneous equilibrium. */
  strain: Float64Array
  strainTarget: Float64Array
  /** per render-vertex radial offset of that figure, km */
  figureOffset: Float32Array
  history: History
  seed: number
  tick: number
  paused: boolean
}

// Weather is resolved on 10,242 cells; the detailed terrain mesh is unchanged.
export const SIM_LEVEL = 5
export const RENDER_LEVEL = 7
const DT = 1
const TRAIL_MAX = 260

/** Planet mass in body units. The law `G` is expressed against this. */
const PLANET_MASS = 1

/**
 * The close massive moon from plan.md, which the planet is tidally locked to.
 *
 * Its orbit is deliberately uninclined. A synchronous orbit that is tilted does not
 * hold still over one spot -- it traces a daily figure-of-eight, the analemma a
 * geosynchronous satellite draws -- and the tidal bulge nods with it once per day.
 * That nodding was the residual wobble, not the tide itself.
 *
 * At 4 planet radii it is still extraordinarily close (our own Moon sits at 60), and
 * it locks the planet to a ~50 tick day. That is fast enough for a real oblateness of
 * about 1/58 without the world looking like it is being kneaded.
 */
export const INNER_MOON_NAME = 'Близнец'
export const INNER_MOON_RADIUS = 4.0

/**
 * Two moons of a planet are Hill-stable when their separation exceeds about 2√3
 * mutual Hill radii. Below that they exchange enough energy to tear the system apart,
 * which is exactly what the previous default did: at 4 and 11 planet radii it scored
 * 2.8, and the outer moon was eventually thrown out of the system.
 */
export const HILL_STABLE_SEPARATION = 2 * Math.sqrt(3)

/** Beyond this distance a body is treated as gone rather than simulated forever. */
const ESCAPE_RADIUS = 60

/**
 * Mutual Hill separation Δ of the two innermost moons, in Hill radii.
 *
 *   R_H = ((m₁+m₂)/3M)^(1/3) · (a₁+a₂)/2 ,   Δ = (a₂−a₁)/R_H
 */
export function hillSeparation(bodies: Body[]): number {
  if (bodies.length < 2) return Infinity
  const d = bodies.map(b => Math.hypot(b.pos[0], b.pos[1], b.pos[2])).sort((a, b) => a - b)
  const a1 = d[0]!, a2 = d[1]!
  const m = bodies.reduce((acc, b) => acc + b.mass, 0)
  const rh = ((m / (3 * PLANET_MASS)) ** (1 / 3)) * ((a1 + a2) / 2)
  if (!Number.isFinite(rh) || rh < 1e-9) return Infinity
  return (a2 - a1) / rh
}

export function createWorld(seed = 20260919, laws: Laws = defaultLaws()): World {
  const sphere = buildSphere(SIM_LEVEL, RENDER_LEVEL)
  const clamped = clampLaws(laws)
  const terrain = generateTerrain(sphere, clamped, seed)
  const caves = generateCaves(sphere, terrain, clamped, seed)
  const air = createAir(sphere.grid)
  const clouds = createClouds(sphere.grid, terrain, clamped)
  const bodies = initialBodies(clamped)
  const figure = computeFigure(bodies, clamped, 0)
  // only the sim cells are ever probed, so this stays at sim resolution
  const figureOffset = new Float32Array(sphere.grid.count)
  const world: World = {
    sphere,
    terrain,
    caves,
    clouds,
    life: createLife(seed),
    air,
    laws: clamped,
    bodies,
    figure,
    strain: new Float64Array(6),
    strainTarget: equilibriumStrain(figure),
    figureOffset,
    history: createHistory(),
    escaped: [],
    seed,
    tick: 0,
    paused: false
  }
  record(world.history, world, true)
  return world
}

/**
 * The two moons from plan.md: a close massive one, and a smaller one on a steeply
 * inclined orbit.
 *
 * The spacing is not arbitrary. A steeply inclined outer moon has its eccentricity
 * pumped up and down by the inner one (the Kozai-Lidov mechanism), so it periodically
 * swings inward; the pair has to stay Hill-stable at that closest approach, not just
 * on average. At 4 and 20 planet radii the separation is about 4.3 Hill radii and
 * stays above the 2*sqrt(3) threshold through the whole cycle. They are launched on circular orbits for the *current* gravity
 * exponent, so at p = 2 they are stable circles -- and the moment the player moves
 * that slider, the orbits stop being closed and start to precess.
 */
export function initialBodies(laws: Laws): Body[] {
  const mk = (name: string, r: number, incl: number, mass: number, radius: number, color: number): Body => {
    const v = circularSpeed(r, laws)
    return {
      name,
      mass,
      radius,
      color,
      pos: [r, 0, 0],
      vel: [0, v * Math.sin(incl), v * Math.cos(incl)],
      trail: []
    }
  }
  return [
    mk(INNER_MOON_NAME, laws.innerOrbitRadius!, laws.innerOrbitInclination! * Math.PI / 180, 0.08, 0.30, 0xc8b8a0),
    mk('Странник', laws.outerOrbitRadius!, laws.outerOrbitInclination! * Math.PI / 180, 0.008, 0.16, 0x8fa6c0)
  ]
}

function circularSpeed(r: number, laws: Laws): number {
  // for F = G·M/r^p the circular condition is v² / r = G·M / r^p
  return Math.sqrt((orbitalGravity(laws) * PLANET_MASS) / r ** (laws.gravityExponent! - 1))
}

/** scratch acceleration buffers, reused so the hot path allocates nothing */
let accA: Float64Array | null = null
let accB: Float64Array | null = null

/**
 * Accelerations of every body from the CURRENT positions of every body.
 *
 * All of them, from one consistent snapshot. Updating each body fully before moving
 * to the next makes the mutual forces asymmetric -- body B feels A's new position
 * while A felt B's old one -- which quietly violates Newton's third law and bleeds
 * energy out of the system. Over a few thousand steps that decayed the inner moon's
 * orbit by 7%, which was enough to break the tidal lock and set the tidal bulge
 * sweeping around the planet again.
 */
function accelerations(bodies: Body[], laws: Laws, out: Float64Array): void {
  const G = orbitalGravity(laws)
  const p = laws.gravityExponent!
  out.fill(0)
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!
    const r = Math.hypot(b.pos[0], b.pos[1], b.pos[2]) || 1e-6
    const a = -(G * PLANET_MASS) / r ** p
    out[i * 3] = out[i * 3]! + ((a * b.pos[0]) / r)
    out[i * 3 + 1] = out[i * 3 + 1]! + ((a * b.pos[1]) / r)
    out[i * 3 + 2] = out[i * 3 + 2]! + ((a * b.pos[2]) / r)

    // pairwise, applied to both bodies at once so the pair always cancels exactly
    for (let j = i + 1; j < bodies.length; j++) {
      const o = bodies[j]!
      const dx = o.pos[0] - b.pos[0], dy = o.pos[1] - b.pos[1], dz = o.pos[2] - b.pos[2]
      const d = Math.hypot(dx, dy, dz) || 1e-6
      const f = G / d ** (p + 1)
      out[i * 3] = out[i * 3]! + (f * o.mass * dx)
      out[i * 3 + 1] = out[i * 3 + 1]! + (f * o.mass * dy)
      out[i * 3 + 2] = out[i * 3 + 2]! + (f * o.mass * dz)
      out[j * 3] = out[j * 3]! - (f * b.mass * dx)
      out[j * 3 + 1] = out[j * 3 + 1]! - (f * b.mass * dy)
      out[j * 3 + 2] = out[j * 3 + 2]! - (f * b.mass * dz)
    }
  }
}

function stepBodies(bodies: Body[], laws: Laws, dt: number): void {
  const n = bodies.length
  if (!accA || accA.length !== n * 3) {
    accA = new Float64Array(n * 3)
    accB = new Float64Array(n * 3)
  }
  const a0 = accA, a1 = accB!

  // velocity-Verlet, symplectic and time-symmetric: an orbit that decays did so
  // because of the law the player edited, not because of the integrator
  accelerations(bodies, laws, a0)
  for (let i = 0; i < n; i++) {
    const b = bodies[i]!
    for (let k = 0; k < 3; k++) b.pos[k] = b.pos[k]! + (b.vel[k]! * dt + 0.5 * a0[i * 3 + k]! * dt * dt)
  }
  accelerations(bodies, laws, a1)
  for (let i = 0; i < n; i++) {
    const b = bodies[i]!
    for (let k = 0; k < 3; k++) b.vel[k] = b.vel[k]! + (0.5 * (a0[i * 3 + k]! + a1[i * 3 + k]!) * dt)

    if (!Number.isFinite(b.pos[0]) || !Number.isFinite(b.pos[1]) || !Number.isFinite(b.pos[2])) {
      b.pos = [laws.innerOrbitRadius!, 0, 0]
      b.vel = [0, 0, circularSpeed(laws.innerOrbitRadius!, laws)]
      b.trail.length = 0
    }
  }
}

/** Global evolution is cheap and is shared by playback and approximate jumps. */
export function stepGlobals(world: World): void {
  // Substeps reduce the artificial eccentricity/phase drift of a ~50-tick orbit.
  for (let s = 0; s < 8; s++) stepBodies(world.bodies, world.laws, DT / 8)
  for (let i = world.bodies.length - 1; i >= 0; i--) {
    const b = world.bodies[i]!
    if (Math.hypot(b.pos[0], b.pos[1], b.pos[2]) > ESCAPE_RADIUS) {
      world.escaped.push(b.name)
      world.bodies.splice(i, 1)
    }
  }
  world.tick += DT
  for (const b of world.bodies) {
    b.trail.push(b.pos[0], b.pos[1], b.pos[2], world.tick)
    if (b.trail.length > TRAIL_MAX * 4) b.trail.splice(0, 4)
  }
  refreshFigure(world)
  equilibriumStrain(world.figure, world.strainTarget)
  relaxStrain(world.strain, world.strainTarget, world.laws, DT)
}

export function stepWorld(world: World, keepHistory = true): void {
  stepAir(world.sphere.grid, world.terrain, world.caves, world.air, world.laws, world.tick, DT)
  stepUpperAir(world.sphere.grid, world.terrain, world.air, world.laws, DT)
  const consumeCharge = prepareLife(world)
  stepClouds(world.sphere.grid, world.terrain, world.air, world.clouds, world.laws, DT, world.tick, consumeCharge)
  finishLife(world)
  stepGlobals(world)
  if (keepHistory) record(world.history, world)
  if (world.air.unstable) world.paused = true
}

/**
 * Recompute equilibrium forcing. The solid strain approaches it in simulation
 * time; rendering never substitutes instantaneous forcing for the actual shape.
 */
export function refreshFigure(world: World): void {
  world.figure = computeFigure(world.bodies, world.laws, world.tick)
}

/** Per-cell figure offsets, for the probe readout. O(cells), so call it rarely. */
export function refreshFigureOffsets(world: World): void {
  const { pos, count } = world.sphere.grid
  for (let i = 0; i < count; i++) {
    world.figureOffset[i] = strainOffsetKm(world.strain, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, planetRadiusKm(world.laws))
  }
}

export function regenerateTerrain(world: World): void {
  world.terrain = generateTerrain(world.sphere, world.laws, world.seed)
  world.caves = generateCaves(world.sphere, world.terrain, world.laws, world.seed)
  world.clouds = createClouds(world.sphere.grid, world.terrain, world.laws)
  world.life = createLife(world.seed)
}

export function resetOrbits(world: World): void {
  world.bodies = initialBodies(world.laws)
  world.escaped = []
  refreshFigure(world)
  resetHistory(world)
}

/** Rotation period that puts the planet in mutual tidal lock with the inner moon. */
export function tidalLockPeriod(laws: Laws): number {
  return orbitalPeriod(laws.innerOrbitRadius ?? INNER_MOON_RADIUS, laws)
}

/**
 * Move the world to an arbitrary tick.
 *
 * Forward is simulation. Backward is replay: restore the newest snapshot at or before
 * the target and re-run the remainder. If the target predates the ring entirely the
 * caller must rebuild from the seed, which `seek` reports by returning false.
 *
 * A wall-clock budget spreads replay across frames instead of freezing the tab.
 */
export function seek(world: World, target: number, budgetMs = 6): { done: boolean, reachable: boolean } {
  if (!Number.isFinite(target)) return { done: false, reachable: false }
  const t = Math.max(0, Math.round(target))
  if (t === world.tick) return { done: true, reachable: true }

  if (t < world.tick) {
    const snap = findFrame(world.history, t)
    if (!snap) return { done: false, reachable: false }
    restore(world, snap)
  }

  const deadline = performance.now() + budgetMs
  while (world.tick < t) {
    stepWorld(world, false)
    if (world.paused || performance.now() >= deadline) break
  }
  if (world.tick % world.history.stride === 0) record(world.history, world)
  return { done: world.tick >= t, reachable: true }
}

export function resetHistory(world: World): void {
  clearHistory(world.history)
  record(world.history, world, true)
}

/** Everything the inspector shows for one clicked cell. */
export interface CellReading {
  cell: number
  lat: number
  lon: number
  elevation: number
  temperature: number
  pressure: number
  windSpeed: number
  beaufort: number
  /** compass bearing the wind is blowing *toward*, degrees clockwise from north */
  windBearing: number
  roughness: number
  insolation: number
  /** 0..1, how cavernous this cell is */
  cavern: number
  cloud: number
  dust: number
  iceFrac: number
  charge: number
  updraft: number
  /** radial offset of the hydrostatic figure at this point, km */
  figureOffset: number
}

export function readCell(world: World, i: number): CellReading {
  const { grid } = world.sphere
  const { air, terrain, laws } = world
  const u = air.windU[i]!, v = air.windV[i]!
  const [sx, sy, sz] = sunDirection(world.tick, laws)
  const insol = Math.max(0,
    grid.pos[i * 3]! * sx + grid.pos[i * 3 + 1]! * sy + grid.pos[i * 3 + 2]! * sz)
  let bearing = (Math.atan2(u, v) * 180) / Math.PI
  if (bearing < 0) bearing += 360
  const speed = toMetresPerSecond(Math.hypot(u, v), laws)
  return {
    cell: i,
    lat: (grid.lat[i]! * 180) / Math.PI,
    lon: (grid.lon[i]! * 180) / Math.PI,
    elevation: terrain.elevSim[i]!,
    temperature: effectiveTemp(air, terrain, laws, i),
    pressure: air.press[i]!,
    windSpeed: speed,
    beaufort: beaufort(speed),
    windBearing: bearing,
    roughness: terrain.roughness[i]!,
    insolation: insol,
    cavern: world.caves.intensity[i]!,
    cloud: (world.clouds.cloud[i]! + world.clouds.cloudAloft[i]!) / Math.max(1e-9, world.clouds.maxCloud),
    dust: (world.clouds.dust[i]! + world.clouds.dustAloft[i]!) / Math.max(1e-9, world.clouds.maxDust),
    iceFrac: world.clouds.iceFrac[i]!,
    charge: world.clouds.charge[i]! / Math.max(1e-9, laws.breakdownField!),
    updraft: world.clouds.updraft[i]!,
    figureOffset: world.figureOffset[i]!
  }
}

/** Headline numbers about the planet's current figure, for the readout panel. */
export interface FigureReading {
  /** mutual Hill separation of the moons; below ~3.46 the system tears itself apart */
  hill: number
  escaped: string[]
  flattening: number
  flatteningInverse: number
  rotParam: number
  equatorialKm: number
  polarKm: number
  bulgeKm: number
  peakTideKm: number
  gravity: number
  clock: Clock
}

export function readFigure(world: World): FigureReading {
  const f = world.figure
  const s = world.strain
  const equatorial = planetRadiusKm(world.laws) * (1 + (s[0]! + s[2]!) * 0.5)
  const polar = planetRadiusKm(world.laws) * (1 + s[1]!)
  const flattening = (equatorial - polar) / equatorial
  return {
    hill: hillSeparation(world.bodies),
    escaped: world.escaped,
    flattening,
    flatteningInverse: flattening > 1e-9 ? 1 / flattening : Infinity,
    rotParam: f.rotParam,
    equatorialKm: equatorial,
    polarKm: polar,
    bulgeKm: equatorial - polar,
    peakTideKm: f.peakTideKm,
    gravity: surfaceGravity(world.laws),
    clock: clockOf(world.tick, world.laws)
  }
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export function compassOf(bearing: number): string {
  return COMPASS[Math.round(bearing / 22.5) % 16]!
}
