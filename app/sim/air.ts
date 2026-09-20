import type { Grid } from './icosphere'
import type { Terrain } from './terrain'
import type { Caves } from './caves'
import type { Laws } from './laws'
import { DAYS_PER_YEAR, corotate } from './units'
import { createUpperAir, type UpperAir } from './upperAir'

/**
 * Atmosphere.
 *
 * One tick, in order:
 *   1. insolation and radiative balance   -> temperature
 *   2. temperature and elevation          -> pressure
 *   3. pressure gradient + Coriolis + drag + terrain blocking -> wind
 *   4. wind                               -> advects temperature
 *   5. viscosity                          -> smooths everything slightly
 *
 * Jet streams are not special-cased anywhere. They fall out of step 3: a pole-to-
 * equator pressure gradient pushed sideways by Coriolis becomes zonal flow, and the
 * shear between bands is the jet. Set `coriolisCoupling` to 0 and they vanish.
 */

export interface Air {
  upper: UpperAir
  temp: Float32Array
  press: Float32Array
  /** Pressure built by convergence; prevents permanent one-way thermal sinks. */
  pressureAnomaly: Float32Array
  windU: Float32Array
  windV: Float32Array
  /** |v|, cached for rendering and the inspector */
  speed: Float32Array
  meanTemp: number
  maxSpeed: number
  /** set when the integrator produced a non-finite value; the sim auto-pauses */
  unstable: string | null
}

// ---------------------------------------------------------------------------
// Calibration anchors. These are unit conversions between simulation units and
// the displayed quantities -- NOT physical laws, which is why they are not in
// the law registry. Nothing here changes the *behaviour* of a law, only its scale.
// ---------------------------------------------------------------------------
/** Reference point that pins the radiative equilibrium so that changing the
 *  emission exponent alters the thermostat's stiffness rather than instantly
 *  boiling or freezing the planet. */
const REF_TEMP = 288
const REF_FLUX = 300
/** Normalised pressure gradient -> velocity units (planet radii per tick).
 *  Sized so that a default law set keeps the wind well below one cell per tick:
 *  the advection scheme is only stable below CFL 1. */
const ACCEL_UNIT = 1e-3
/** elevation gradient magnitude considered a "full" slope for blocking purposes */
const SLOPE_REF = 220
/** Wind speed at which flow over a full-strength slope has Froude number 1.
 *  Below it the air is deflected around the obstacle; above it, it climbs over. */
const FROUDE_REF = 0.02

export function createAir(grid: Grid): Air {
  const n = grid.count
  const temp = new Float32Array(n)
  for (let i = 0; i < n; i++) temp[i] = 250 + 60 * Math.cos(grid.lat[i]!)
  return {
    upper: createUpperAir(n),
    temp,
    press: new Float32Array(n),
    pressureAnomaly: new Float32Array(n),
    windU: new Float32Array(n),
    windV: new Float32Array(n),
    speed: new Float32Array(n),
    meanTemp: 280,
    maxSpeed: 0,
    unstable: null
  }
}

/**
 * Unit vector toward the star, expressed in the planet's co-rotating frame.
 *
 * The star is fixed in inertial space apart from a slow seasonal declination; what
 * makes it sweep the sky is the planet turning underneath it. Building it through the
 * same `corotate` the moons use is what keeps the two consistent -- otherwise a
 * tidally locked moon would still appear to race around the sky.
 */
export function sunDirection(t: number, laws: Laws): [number, number, number] {
  const yearLength = Math.max(1, laws.rotationPeriod!) * DAYS_PER_YEAR
  const decl = laws.axialTilt! * Math.sin((2 * Math.PI * t) / yearLength)
  return corotate(Math.cos(decl), Math.sin(decl), 0, t, laws)
}

/** Temperature actually felt at the surface, i.e. after the lapse rate. */
export function effectiveTemp(air: Air, terrain: Terrain, laws: Laws, i: number): number {
  return air.temp[i]! - laws.lapseRate! * Math.max(0, terrain.elevSim[i]!)
}

// scratch buffers, allocated once and reused -- no allocation in the hot loop
let scratchPress: Float32Array | null = null
let scratchTemp: Float32Array | null = null
let oldU: Float32Array | null = null
let oldV: Float32Array | null = null

export function stepAir(
  grid: Grid,
  terrain: Terrain,
  caves: Caves,
  air: Air,
  laws: Laws,
  t: number,
  dt: number
): void {
  const n = grid.count
  if (!scratchPress || scratchPress.length !== n) {
    scratchPress = new Float32Array(n)
    scratchTemp = new Float32Array(n)
    oldU = new Float32Array(n)
    oldV = new Float32Array(n)
  }
  const pN = scratchPress
  const tOld = scratchTemp!
  const transport = windTransport(grid)
  const uOld = oldU!, vOld = oldV!
  uOld.set(air.windU)
  vOld.set(air.windV)

  const [sx, sy, sz] = sunDirection(t, laws)

  const solar = laws.solarConstant!
  const albedo = laws.albedo!
  const green = laws.greenhouse!
  const nExp = laws.emissionExponent!
  const inertia = Math.max(0.05, laws.thermalInertia!)
  const caveBuffer = laws.caveBuffering!
  const sigma = REF_FLUX / REF_TEMP ** nExp

  // ---- 1. radiative balance ---------------------------------------------------
  let tSum = 0
  for (let i = 0; i < n; i++) {
    const insol = Math.max(0,
      grid.pos[i * 3]! * sx + grid.pos[i * 3 + 1]! * sy + grid.pos[i * 3 + 2]! * sz)
    const absorbed = solar * insol * (1 - albedo)
    const T = air.temp[i]!
    const emitted = sigma * T ** nExp * (1 - green)
    // a cavernous cell carries far more thermal mass and is shielded from the sky,
    // so it rides out the diurnal swing the open surface cannot
    const heatCapacity = inertia * (1 + caveBuffer * caves.intensity[i]!)
    let next = T + (dt * (absorbed - emitted)) / heatCapacity
    if (!Number.isFinite(next)) { air.unstable = 'emissionExponent'; next = REF_TEMP }
    next = next < 3 ? 3 : next > 4000 ? 4000 : next
    air.temp[i] = next
    tOld[i] = next
    tSum += next
  }
  air.meanTemp = tSum / n

  // ---- 2. pressure ------------------------------------------------------------
  const kT = laws.thermalPressure!
  const kH = laws.orographicPressure!
  const lapse = laws.lapseRate!
  let pSum = 0, pSq = 0
  for (let i = 0; i < n; i++) {
    const h = terrain.elevSim[i]!
    const tEff = air.temp[i]! - lapse * (h > 0 ? h : 0)
    // hot air rises and leaves low pressure behind; high ground has thinner air
    // Continuity: converging air raises local pressure and pushes back. Without
    // this feedback the warm equator is a permanent sink regardless of terrain.
    let div = 0
    const start = grid.nbrStart[i]!, end = grid.nbrStart[i + 1]!
    for (let k = start; k < end; k++) {
      const j = grid.nbrList[k]!
      const ju = uOld[j]! * transport[k * 4]! + vOld[j]! * transport[k * 4 + 1]!
      const jv = uOld[j]! * transport[k * 4 + 2]! + vOld[j]! * transport[k * 4 + 3]!
      div += ((ju - uOld[i]!) * grid.nbrU[k]! + (jv - vOld[i]!) * grid.nbrV[k]!) / grid.nbrLen[k]!
    }
    div = div * 2 / (end - start)
    const response = laws.continuityCoupling!
    air.pressureAnomaly[i] = Math.max(-250, Math.min(250,
      (air.pressureAnomaly[i]! - response * div * dt) * Math.exp(-dt / 80)))
    const p = 1000 - kT * (tEff - air.meanTemp) - kH * h + air.pressureAnomaly[i]!
    air.press[i] = p
    pSum += p
    pSq += p * p
  }
  const pMean = pSum / n
  const pStd = Math.sqrt(Math.max(1e-9, pSq / n - pMean * pMean))
  // Normalising here is what keeps the wind laws meaningful when the player
  // rescales temperature: the gradient stays O(1) whatever the field's units.
  for (let i = 0; i < n; i++) pN[i] = (air.press[i]! - pMean) / pStd

  // ---- 3. wind ----------------------------------------------------------------
  const alpha = laws.pressureCoupling! * ACCEL_UNIT
  const beta = laws.dragCoefficient!
  const block = laws.terrainBlocking!
  const trap = laws.caveTrapping!
  // f = c·Ω·sin φ. Ω per tick is just 2π / rotation period, so the Coriolis force
  // and the length of a day are now the same law rather than two unrelated sliders.
  const fBase = (laws.coriolisCoupling! * 2 * Math.PI) / Math.max(1, laws.rotationPeriod!)
  let maxSpeed = 0

  for (let i = 0; i < n; i++) {
    const s = grid.nbrStart[i]!, e = grid.nbrStart[i + 1]!
    const deg = e - s

    let gu = 0, gv = 0
    for (let k = s; k < e; k++) {
      const d = (pN[grid.nbrList[k]!]! - pN[i]!) / grid.nbrLen[k]!
      gu += d * grid.nbrU[k]!
      gv += d * grid.nbrV[k]!
    }
    gu = (gu * 2) / deg
    gv = (gv * 2) / deg

    let u = air.windU[i]!, v = air.windV[i]!

    // Transport momentum, not just temperature. Upwind interpolation with a
    // bounded Courant number carries jets/eddies without an unstable Euler step.
    const spOld = Math.hypot(u, v)
    let up = -1, best = 0
    for (let k = s; k < e; k++) {
      const align = -(grid.nbrU[k]! * u + grid.nbrV[k]! * v) / Math.max(1e-9, spOld)
      if (align > best) { best = align; up = k }
    }
    if (up >= 0) {
      const j = grid.nbrList[up]!
      const ju = uOld[j]! * transport[up * 4]! + vOld[j]! * transport[up * 4 + 1]!
      const jv = uOld[j]! * transport[up * 4 + 2]! + vOld[j]! * transport[up * 4 + 3]!
      const courant = Math.min(1, spOld * dt / grid.nbrLen[up]!) * best * laws.momentumAdvection!
      u += (ju - u) * courant
      v += (jv - v) * courant
    }

    // pressure-gradient force
    u += -alpha * gu * dt
    v += -alpha * gv * dt

    // Coriolis as an exact rotation rather than an added acceleration: stable at
    // any timestep and it cannot inject energy the way an explicit term does.
    const f = fBase * Math.sin(grid.lat[i]!)
    const ang = -f * dt
    const ca = Math.cos(ang), sa = Math.sin(ang)
    const ur = u * ca - v * sa
    const vr = u * sa + v * ca
    u = ur; v = vr

    // terrain blocking: wind cannot climb a steep slope, so the up-slope part of
    // the velocity is removed and the flow is deflected along the contour
    if (block > 0) {
      const ghu = terrain.gradU[i]!, ghv = terrain.gradV[i]!
      const gm = Math.hypot(ghu, ghv)
      if (gm > 1e-6) {
        const proj = (u * ghu + v * ghv) / gm
        if (proj > 0) {
          // Froude number Fr = U / (N·h) decides whether stratified flow goes OVER a
          // ridge or around it. Blocking that ignores it walls off every mountain and
          // leaves dead air behind each range; with it, jets surmount the ridge and
          // only sluggish flow is turned aside.
          const slopeNorm = Math.min(1, gm / SLOPE_REF)
          const fr = Math.hypot(u, v) / (FROUDE_REF * slopeNorm + 1e-9)
          const gate = 1 / (1 + fr * fr)
          const strength = Math.min(0.85, block * slopeNorm * gate * dt)
          u -= strength * proj * (ghu / gm)
          v -= strength * proj * (ghv / gm)
        }
      }
    }

    // drag, amplified by surface roughness and by how cavernous the ground is:
    // a cave field is a momentum sink, and wind that enters one stalls
    const resistance = 1 + 0.6 * terrain.roughness[i]! + trap * caves.intensity[i]!
    const damp = 1 - Math.min(0.95, beta * resistance * dt)
    u *= damp
    v *= damp

    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      air.unstable = 'pressureCoupling'
      u = 0; v = 0
    }
    air.windU[i] = u
    air.windV[i] = v
    const sp = Math.hypot(u, v)
    air.speed[i] = sp
    if (sp > maxSpeed) maxSpeed = sp
  }
  air.maxSpeed = maxSpeed

  // ---- 4. advection of heat by the wind ---------------------------------------
  // First-order upwind: take the temperature difference against the neighbour the
  // wind is coming FROM. A centred difference looks more accurate and is violently
  // unstable above CFL 1 -- it oscillates, hits the temperature clamps, and because
  // the floor is far nearer to ambient than the ceiling, the whole planet drifts
  // toward absolute zero. Upwind is merely diffusive instead.
  const adv = laws.advectionStrength!
  if (adv > 0) {
    for (let i = 0; i < n; i++) {
      const u = air.windU[i]!, v = air.windV[i]!
      const sp = Math.hypot(u, v)
      if (sp < 1e-9) continue
      const du = u / sp, dv = v / sp

      const s = grid.nbrStart[i]!, e = grid.nbrStart[i + 1]!
      let up = -1, best = 0
      for (let k = s; k < e; k++) {
        // most directly upwind neighbour: the one opposite the flow direction
        const align = -(grid.nbrU[k]! * du + grid.nbrV[k]! * dv)
        if (align > best) { best = align; up = k }
      }
      if (up < 0) continue

      const j = grid.nbrList[up]!
      const grad = (tOld[i]! - tOld[j]!) / grid.nbrLen[up]!
      // clamp the Courant number so a fast gust can never overshoot its own cell
      const courant = Math.min(1, (sp * dt) / grid.nbrLen[up]!)
      // sheltered air exchanges less with the open surface: without this the lateral
      // mixing simply drags a cavern back to whatever its neighbours are doing, and
      // the extra heat capacity buys nothing
      const shelter = 1 / (1 + caveBuffer * caves.intensity[i]!)
      const d = -adv * grad * best * courant * grid.nbrLen[up]! * shelter
      const next = air.temp[i]! + d
      air.temp[i] = Number.isFinite(next) ? Math.max(3, Math.min(4000, next)) : air.temp[i]!
    }
  }

  // ---- 4b. cavern conduits ----------------------------------------------------
  // Two chambers joined by a tunnel short-circuit the surface: where their mouths
  // differ in pressure, air moves through the rock instead of over it and drags heat
  // along with it. Local, but it is what lets a cave system pierce a ridge.
  const conduct = laws.caveConduction!
  if (conduct > 0) {
    for (let k = 0; k < caves.count; k++) {
      const a = caves.links[k * 2]!
      const b = caves.links[k * 2 + 1]!
      const dp = pN[a]! - pN[b]!
      // flow runs from the high-pressure mouth to the low one
      const flux = Math.min(0.4, Math.abs(dp) * conduct * dt)
      const from = dp > 0 ? a : b
      const to = dp > 0 ? b : a
      const carried = (air.temp[from]! - air.temp[to]!) * flux
      air.temp[to] = air.temp[to]! + carried
      air.temp[from] = air.temp[from]! - carried * 0.5
    }
  }

  // ---- 5. viscosity -----------------------------------------------------------
  const nu = laws.viscosity!
  if (nu > 0) {
    uOld.set(air.windU)
    vOld.set(air.windV)
    const kBase = Math.min(0.49, nu * dt)
    for (let i = 0; i < n; i++) {
      const k = kBase / (1 + caveBuffer * caves.intensity[i]!)
      const s = grid.nbrStart[i]!, e = grid.nbrStart[i + 1]!
      let st = 0, su = 0, sv = 0
      for (let m = s; m < e; m++) {
        const j = grid.nbrList[m]!
        st += tOld[j]!
        const ju = uOld[j]! * transport[m * 4]! + vOld[j]! * transport[m * 4 + 1]!
        const jv = uOld[j]! * transport[m * 4 + 2]! + vOld[j]! * transport[m * 4 + 3]!
        su += ju
        sv += jv
      }
      const deg = e - s
      air.temp[i] = air.temp[i]! + k * (st / deg - air.temp[i]!)
      air.windU[i] = air.windU[i]! + k * (su / deg - air.windU[i]!)
      air.windV[i] = air.windV[i]! + k * (sv / deg - air.windV[i]!)
    }
  }
  // Readouts and downstream clouds must see the final, post-viscosity field.
  let finalMax = 0, finalTemp = 0
  for (let i = 0; i < n; i++) {
    air.speed[i] = Math.hypot(air.windU[i]!, air.windV[i]!)
    finalMax = Math.max(finalMax, air.speed[i]!)
    finalTemp += air.temp[i]!
  }
  air.maxSpeed = finalMax
  air.meanTemp = finalTemp / n
}

const transportCache = new WeakMap<Grid, Float64Array>()

/** Precompute neighbour basis transforms once; no allocations in the tick loop. */
export function windTransport(grid: Grid): Float64Array {
  const cached = transportCache.get(grid)
  if (cached) return cached
  const out = new Float64Array(grid.nbrList.length * 4)
  for (let i = 0; i < grid.count; i++) {
    for (let k = grid.nbrStart[i]!; k < grid.nbrStart[i + 1]!; k++) {
      const j = grid.nbrList[k]!
      for (let c = 0; c < 3; c++) {
        out[k * 4] = out[k * 4]! + grid.east[j * 3 + c]! * grid.east[i * 3 + c]!
        out[k * 4 + 1] = out[k * 4 + 1]! + grid.north[j * 3 + c]! * grid.east[i * 3 + c]!
        out[k * 4 + 2] = out[k * 4 + 2]! + grid.east[j * 3 + c]! * grid.north[i * 3 + c]!
        out[k * 4 + 3] = out[k * 4 + 3]! + grid.north[j * 3 + c]! * grid.north[i * 3 + c]!
      }
    }
  }
  transportCache.set(grid, out)
  return out
}
