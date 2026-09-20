import type { Grid } from './icosphere'
import type { Terrain } from './terrain'
import type { Laws } from './laws'
import type { Air } from './air'
import { windTransport, sunDirection } from './air'
import { transportTracers } from './tracerTransport'

/**
 * CLOUDS: dust, condensate, ice, and charge.
 *
 * This world is mostly rock and dust with a little frost on the cold high ground, so
 * it makes two quite different kinds of cloud, and the difference is visible: ochre
 * dust raised off the plains, and pale ice condensed over the ranges. Only the second
 * can ever thunder, because charging needs ice.
 *
 * WHAT CONDENSES — saturation
 *
 * Magnus/Tetens with the Alduchov & Eskridge (1996) coefficients, which hold to about
 * 0.4% over the meteorological range:
 *
 *     e_s(T) = 6.1094 · exp(17.625·T / (T + 243.04))      over liquid, T in °C
 *     e_s(T) = 6.1121 · exp(22.587·T / (T + 273.86))      over ice
 *
 * The ice form matters here: this planet spends most of its time below freezing, and
 * saturation over ice is lower than over liquid, so cloud forms more readily than the
 * liquid curve would suggest. Mixing ratio then follows from Dalton:
 *
 *     q_s = 0.622 · e_s / (p − e_s)
 *
 * WHERE IT CONDENSES — lifting
 *
 * Air only condenses when something lifts it and it cools past its dew point. Two
 * lifting mechanisms, both real: orographic (wind forced up a slope, v·∇h) and
 * convergent (air piling in, −∇·v). The parcel is cooled by the lapse rate over the
 * lift, which is Espy's approximation to the lifting condensation level — the LCL sits
 * about 125 m above the surface per degree of dew-point depression.
 *
 * WHAT GETS RAISED — saltation
 *
 * Dust does not lift directly; sand-sized grains saltate first and blast dust free.
 * Bagnold's result, still the standard, is that the flux goes as the cube of the
 * friction velocity above a threshold:
 *
 *     u*² = C_d·U² ,    Q ∝ (u*³ − u*t³)   for u* > u*t
 *
 * Below the threshold nothing moves at all, which is why dust storms switch on rather
 * than fade in.
 *
 * WHAT THUNDERS — non-inductive charging
 *
 * Lightning needs rebounding collisions between graupel and ice crystals in the
 * presence of supercooled water. That means a cloud is only electrified in the
 * MIXED-PHASE band, between roughly 0 and −40 °C, and the charging is strongest near
 * −15 °C. So the term peaks where the ice fraction is one half — where both phases are
 * present — and dies where the cloud is all liquid or all ice. It also needs an updraft
 * to keep the two populations colliding.
 *
 * A dry dust cloud charges too, by plain triboelectricity, but far more weakly; it is
 * the ice that makes a real storm. Which is exactly plan.md's premise for where the
 * residents will live.
 */

export interface Clouds {
  /** water vapour mixing ratio, kg/kg */
  vapor: Float32Array
  /** airborne dust loading */
  dust: Float32Array
  /** Finite loose surface material, replenished by settling airborne dust. */
  surfaceDust: Float32Array
  /** condensed cloud mass, kg/kg */
  cloud: Float32Array
  /** frozen fraction of the condensate, 0..1 */
  iceFrac: Float32Array
  /** electrification */
  charge: Float32Array
  /** surface frost available to sublimate */
  frost: Float32Array
  /** vertical velocity proxy from lifting */
  updraft: Float32Array
  /** cells that broke down this tick */
  flashes: number[]
  maxCloud: number
  maxDust: number
  maxCharge: number
  stormCells: number
}

// ---------------------------------------------------------------------------
// Unit conversions between simulation units and the meteorological formulae.
// Not laws: they carry no behaviour, only scale.
// ---------------------------------------------------------------------------
/** saltation flux (sim velocity cubed) -> dust loading units */
const DUST_UNIT = 4e5
/** updraft proxy -> kilometres of lift, for the LCL cooling */
const LIFT_KM = 260
/** freezing point and the temperature at which a cloud is wholly glaciated */
const T_FREEZE = 273.15
const T_GLACIATE = 233.15
/** peak of the non-inductive charging response, and its width */
const T_CHARGE_PEAK = 258.15
const T_CHARGE_WIDTH = 9
/** Charging rate scale. Sized so a vigorous storm cell takes tens of ticks to reach
 *  breakdown rather than saturating every tick -- charge that pins itself at the
 *  threshold carries no information and the sky just strobes. */
const CHARGE_UNIT = 9000
const DUST_CHARGE_UNIT = 0.2

/** Saturation vapour pressure in hPa, Alduchov & Eskridge improved Magnus form. */
function saturationPressure(tK: number): number {
  const tc = tK - T_FREEZE
  return tc < 0
    ? 6.1121 * Math.exp((22.587 * tc) / (tc + 273.86))
    : 6.1094 * Math.exp((17.625 * tc) / (tc + 243.04))
}

/** Saturation mixing ratio, kg/kg, from Dalton's law. */
function saturationMixing(tK: number, pressureHpa: number): number {
  const es = saturationPressure(tK)
  return (0.622 * es) / Math.max(1, pressureHpa - es)
}

export function createClouds(grid: Grid, terrain: Terrain, laws: Laws): Clouds {
  const n = grid.count
  const frost = new Float32Array(n)
  const surfaceDust = new Float32Array(n)
  // frost survives where the ground is high and therefore cold: this is the small
  // ice reserve plan.md puts on the mountain tips, and it is the only water this
  // world has to make a cloud out of
  const line = laws.frostLine!
  for (let i = 0; i < n; i++) {
    const h = terrain.elevSim[i]!
    frost[i] = h > line ? Math.min(1, (h - line) / Math.max(1, line)) : 0
    surfaceDust[i] = 2 + 6 / (1 + terrain.roughness[i]!)
  }
  return {
    vapor: new Float32Array(n),
    dust: new Float32Array(n),
    surfaceDust,
    cloud: new Float32Array(n),
    iceFrac: new Float32Array(n),
    charge: new Float32Array(n),
    frost,
    updraft: new Float32Array(n),
    flashes: [],
    maxCloud: 1e-9,
    maxDust: 1e-9,
    maxCharge: 1e-9,
    stormCells: 0
  }
}

export function stepClouds(
  grid: Grid,
  terrain: Terrain,
  air: Air,
  c: Clouds,
  laws: Laws,
  dt: number,
  tick = 0
): void {
  const n = grid.count
  const transport = windTransport(grid)
  const [sunX, sunY, sunZ] = sunDirection(tick, laws)

  c.flashes.length = 0

  const oro = laws.orographicLift!
  const conv = laws.convergenceLift!
  const supply = laws.vapourSupply!
  const condense = laws.condensation!
  const decay = laws.cloudDecay!
  const liftC = laws.dustLifting!
  const uT = laws.dustThreshold!
  const settle = laws.dustSettling!
  const cd = laws.dragCoefficient!
  const lapse = laws.lapseRate!
  const chargeRate = laws.chargeRate!
  const dustCharge = laws.dustCharge!
  const leak = laws.chargeLeak!
  const breakdown = laws.breakdownField!

  let maxCloud = 1e-9, maxDust = 1e-9, maxCharge = 1e-9, storms = 0
  const uT3 = uT * uT * uT

  for (let i = 0; i < n; i++) {
    const u = air.windU[i]!, v = air.windV[i]!
    const sp = Math.hypot(u, v)

    // ---- lifting: orographic (up the slope) plus convergent (air piling in) ----
    const upslope = u * terrain.gradU[i]! + v * terrain.gradV[i]!
    let div = 0
    const s = grid.nbrStart[i]!, e = grid.nbrStart[i + 1]!
    for (let k = s; k < e; k++) {
      const j = grid.nbrList[k]!
      const du = air.windU[j]! * transport[k * 4]! + air.windV[j]! * transport[k * 4 + 1]! - u
      const dv = air.windU[j]! * transport[k * 4 + 2]! + air.windV[j]! * transport[k * 4 + 3]! - v
      div += (du * grid.nbrU[k]! + dv * grid.nbrV[k]!) / grid.nbrLen[k]!
    }
    div = (div * 2) / (e - s)
    const lift = Math.max(0, upslope * oro * 1e-3) + Math.max(0, -div * conv * 1e-3)
    c.updraft[i] = lift

    // ---- dust: saltation only starts above the threshold friction velocity ----
    // u*² = C_d·U², and Bagnold's flux goes as the cube above threshold
    const ustar = sp * Math.sqrt(cd * (1 + terrain.roughness[i]!))
    if (ustar > uT) {
      const flux = (ustar * ustar * ustar - uT3) * liftC * DUST_UNIT
      const lifted = Math.min(c.surfaceDust[i]!, flux * dt)
      c.dust[i] = c.dust[i]! + lifted
      c.surfaceDust[i] = c.surfaceDust[i]! - lifted
    }
    // gravitational settling
    const settled = c.dust[i]! * -Math.expm1(-settle * dt)
    c.dust[i] = c.dust[i]! - settled
    c.surfaceDust[i] = c.surfaceDust[i]! + settled

    // ---- vapour: the frost on the high cold ground sublimates when the sun hits --
    // Use the local mountain temperature, as the inspector does. Using the
    // reference-level temperature made high cold ranges unable to condense.
    const T = Math.max(3, air.temp[i]! - lapse * Math.max(0, terrain.elevSim[i]!))
    if (c.frost[i]! > 0) {
      const sun = Math.max(0, grid.pos[i * 3]! * sunX + grid.pos[i * 3 + 1]! * sunY + grid.pos[i * 3 + 2]! * sunZ)
      const released = Math.min(c.frost[i]!, c.frost[i]! * supply * 1e-5 * dt * sun)
      c.vapor[i] = c.vapor[i]! + released
      c.frost[i] = c.frost[i]! - released
    }

    // ---- condensation at the lifting condensation level ------------------------
    // the parcel is cooled by the lapse rate over however far it is lifted; that is
    // Espy's approximation to the LCL
    const tParcel = T - lapse * lift * LIFT_KM
    const qs = saturationMixing(Math.max(60, tParcel), Math.max(1, air.press[i]!))
    const excess = c.vapor[i]! - qs
    if (excess > 0) {
      const made = excess * Math.min(1, condense * dt)
      c.vapor[i] = c.vapor[i]! - made
      c.cloud[i] = c.cloud[i]! + made
    } else {
      // sub-saturated air evaporates the cloud back into vapour
      const deficit = Math.max(0, Math.min(1, -excess / Math.max(1e-9, qs)))
      const lost = c.cloud[i]! * -Math.expm1(-decay * deficit * dt)
      c.cloud[i] = c.cloud[i]! - lost
      c.vapor[i] = c.vapor[i]! + lost
    }

    // Condensate falls out instead of accumulating indefinitely at cold sinks.
    const fallout = c.cloud[i]! * -Math.expm1(-laws.cloudFallout! * dt)
    c.cloud[i] = c.cloud[i]! - fallout
    c.frost[i] = c.frost[i]! + fallout

    // ---- phase: the mixed-phase band is where charging can happen --------------
    const frac = Math.min(1, Math.max(0, (T_FREEZE - T) / (T_FREEZE - T_GLACIATE)))
    c.iceFrac[i] = frac

    // ---- non-inductive charging ------------------------------------------------
    // needs graupel AND ice crystals AND supercooled water, so it peaks where the
    // phases are mixed and dies at either extreme; strongest near -15 °C
    const mixed = 4 * frac * (1 - frac)
    const tw = Math.exp(-(((T - T_CHARGE_PEAK) / T_CHARGE_WIDTH) ** 2))
    const iceCharging = chargeRate * c.cloud[i]! * mixed * tw * lift * CHARGE_UNIT
    // a dry dust cloud charges by plain triboelectricity, but far more weakly
    const dustCharging = dustCharge * c.dust[i]! * sp * DUST_CHARGE_UNIT
    let q = c.charge[i]! + (iceCharging + dustCharging) * dt
    q -= q * Math.min(0.9, leak * dt)

    if (q > breakdown) {
      c.flashes.push(i)
      q *= 0.12
    }
    c.charge[i] = Math.max(0, q)

    if (c.cloud[i]! > 0 && q > breakdown * 0.45) storms++
    if (c.charge[i]! > maxCharge) maxCharge = c.charge[i]!
  }

  // ---- advection: the wind carries cloud, dust and vapour with it --------------
  transportTracers(grid, air, [c.cloud, c.dust, c.vapor], dt)

  // Maxima describe the transported field, not the pre-advection source peaks.
  for (let i = 0; i < n; i++) {
    maxCloud = Math.max(maxCloud, c.cloud[i]!)
    maxDust = Math.max(maxDust, c.dust[i]!)
  }

  c.maxCloud = maxCloud
  c.maxDust = maxDust
  c.maxCharge = maxCharge
  c.stormCells = storms
}
