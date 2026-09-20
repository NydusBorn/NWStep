import type { Grid } from './icosphere'
import type { Terrain } from './terrain'
import type { Laws } from './laws'
import { windTransport, type Air } from './air'

export interface UpperAir {
  temp: Float32Array
  press: Float32Array
  windU: Float32Array
  windV: Float32Array
  /** Signed fraction of a column exchanged per tick: positive means rising. */
  exchange: Float32Array
  pressureAnomaly: Float32Array
  ready: boolean
}

export function createUpperAir(n: number): UpperAir {
  return { temp: new Float32Array(n), press: new Float32Array(n),
    windU: new Float32Array(n), windV: new Float32Array(n),
    exchange: new Float32Array(n), pressureAnomaly: new Float32Array(n), ready: false }
}

const cache = new WeakMap<Grid, Float32Array[]>()

/** A two-layer circulation closure, not a 3-D atmospheric solver. Warm columns
 * expand and drive pressure gradients aloft. Surface convergence lifts tracers
 * into this independently moving layer; divergence draws upper material down. */
export function stepUpperAir(g: Grid, terrain: Terrain, air: Air, laws: Laws, dt: number): void {
  const upper = air.upper, n = g.count, basis = windTransport(g)
  let buffers = cache.get(g)
  if (!buffers) { buffers = Array.from({ length: 4 }, () => new Float32Array(n)); cache.set(g, buffers) }
  const [oldU, oldV, oldT, pressure] = buffers as [Float32Array, Float32Array, Float32Array, Float32Array]
  if (!upper.ready) {
    for (let i = 0; i < n; i++) {
      upper.temp[i] = Math.max(60, air.temp[i]! - laws.lapseRate! * (Math.max(0, terrain.elevSim[i]!) + laws.upperAltitude!))
    }
    upper.ready = true
  }
  oldU.set(upper.windU); oldV.set(upper.windV); oldT.set(upper.temp)
  let mean = 0
  for (let i = 0; i < n; i++) {
    const target = Math.max(60, air.temp[i]! - laws.lapseRate! * (Math.max(0, terrain.elevSim[i]!) + laws.upperAltitude!))
    upper.temp[i] = oldT[i]! + (target - oldT[i]!) * -Math.expm1(-dt / laws.upperThermalTime!)
    const start = g.nbrStart[i]!, end = g.nbrStart[i + 1]!
    let div = 0, divUpper = 0, upwind = 0, weight = 0
    for (let k = start; k < end; k++) {
      const j = g.nbrList[k]!
      const ju = air.windU[j]! * basis[k * 4]! + air.windV[j]! * basis[k * 4 + 1]!
      const jv = air.windU[j]! * basis[k * 4 + 2]! + air.windV[j]! * basis[k * 4 + 3]!
      div += ((ju - air.windU[i]!) * g.nbrU[k]! + (jv - air.windV[i]!) * g.nbrV[k]!) / g.nbrLen[k]!
      const uu = oldU[j]! * basis[k * 4]! + oldV[j]! * basis[k * 4 + 1]!
      const uv = oldU[j]! * basis[k * 4 + 2]! + oldV[j]! * basis[k * 4 + 3]!
      divUpper += ((uu - oldU[i]!) * g.nbrU[k]! + (uv - oldV[i]!) * g.nbrV[k]!) / g.nbrLen[k]!
      const f = Math.max(0, -(oldU[i]! * g.nbrU[k]! + oldV[i]! * g.nbrV[k]!)) / g.nbrLen[k]!
      upwind += f * oldT[j]!; weight += f
    }
    div *= 2 / (end - start); divUpper *= 2 / (end - start)
    if (weight > 0) upper.temp[i] = upper.temp[i]! + (upwind / weight - oldT[i]!) * Math.min(0.8, weight * dt * 2 / (end - start))
    const slopeLift = Math.max(0, air.windU[i]! * terrain.gradU[i]! + air.windV[i]! * terrain.gradV[i]!) * laws.orographicLift! * 0.001
    const exchange = Math.max(-0.08, Math.min(0.08, laws.verticalExchange! * (-div * 0.5 + slopeLift)))
    upper.exchange[i] = exchange
    // Exchange changes both layers' pressure anomalies with opposite signs.
    const transfer = laws.continuityCoupling! * exchange * dt
    air.pressureAnomaly[i] = Math.max(-250, Math.min(250, air.pressureAnomaly[i]! - transfer))
    upper.pressureAnomaly[i] = Math.max(-250, Math.min(250,
      (upper.pressureAnomaly[i]! + transfer - laws.continuityCoupling! * divUpper * dt) * Math.exp(-dt / 80)))
    mean += upper.temp[i]!
  }
  mean /= n
  let sum = 0, sq = 0
  for (let i = 0; i < n; i++) {
    const p = laws.thermalPressure! * (upper.temp[i]! - mean) + upper.pressureAnomaly[i]!
    pressure[i] = p; sum += p; sq += p * p
    // Approximate hydrostatic pressure at the representative layer height.
    upper.press[i] = Math.max(1, air.press[i]! * Math.exp(-laws.upperAltitude! / 12))
  }
  const avg = sum / n, std = Math.max(1, Math.sqrt(Math.max(0, sq / n - avg * avg)))
  for (let i = 0; i < n; i++) {
    const start = g.nbrStart[i]!, end = g.nbrStart[i + 1]!, deg = end - start
    let gu = 0, gv = 0, su = 0, sv = 0
    for (let k = start; k < end; k++) {
      const j = g.nbrList[k]!, d = (pressure[j]! - pressure[i]!) / (std * g.nbrLen[k]!)
      gu += d * g.nbrU[k]!; gv += d * g.nbrV[k]!
      su += oldU[j]! * basis[k * 4]! + oldV[j]! * basis[k * 4 + 1]!
      sv += oldU[j]! * basis[k * 4 + 2]! + oldV[j]! * basis[k * 4 + 3]!
    }
    const mix = Math.min(0.4, laws.viscosity! * dt)
    let u = oldU[i]! + (su / deg - oldU[i]!) * mix - laws.pressureCoupling! * 0.001 * gu * 2 / deg * dt
    let v = oldV[i]! + (sv / deg - oldV[i]!) * mix - laws.pressureCoupling! * 0.001 * gv * 2 / deg * dt
    const entrain = -Math.expm1(-Math.max(0, upper.exchange[i]!) * dt)
    u += (air.windU[i]! - u) * entrain; v += (air.windV[i]! - v) * entrain
    const angle = -laws.coriolisCoupling! * 2 * Math.PI / laws.rotationPeriod! * Math.sin(g.lat[i]!) * dt
    const damping = Math.exp(-laws.upperDrag! * dt), co = Math.cos(angle), si = Math.sin(angle)
    upper.windU[i] = (u * co - v * si) * damping
    upper.windV[i] = (u * si + v * co) * damping
    if (!Number.isFinite(upper.windU[i]) || !Number.isFinite(upper.temp[i])) air.unstable = 'upper atmosphere'
  }
}
