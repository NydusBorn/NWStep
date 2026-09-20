import type { Laws } from './laws'
import type { Body } from './world'
import { PLANET_RADIUS_KM, corotate, rotationalParameter } from './units'

/**
 * THE FIGURE OF THE PLANET.
 *
 * The planet is not a sphere with a shape hand-authored onto it. Its figure is the
 * hydrostatic equilibrium surface implied by the current laws, computed from the
 * same textbook relations used for real planets.
 *
 * Two degree-2 deformations, both governed by the same Love number h₂ because both
 * are the body's response to a degree-2 potential:
 *
 *   ROTATIONAL FLATTENING (Maclaurin, slow-rotation limit)
 *     m = Ω²R³ / GM                      centrifugal / gravitational at the equator
 *     f = (h₂ / 2) · m                   (a − c) / a
 *     r(φ) = R · (1 − f·sin²φ)
 *   Check: Earth's m = 3.45e-3 and its fluid h₂ ≈ 1.95 give f = 1/298, which is
 *   Earth's actual flattening. A homogeneous body has h₂ = 5/2 and f = (5/4)m.
 *
 *   TIDAL BULGE (equilibrium tide)
 *     ζ = h₂ · (m_sat / M) · R⁴ / d³ · P₂(cos θ)
 *   Check: the Moon on Earth gives ζ ≈ 0.9 m at the sub-lunar point, the right order
 *   for the equilibrium tide.
 *
 *   Generalised for an editable force law. For F ∝ r^−p the multipole expansion puts
 *   the degree-2 tidal coefficient at p(p+1)/6 · (R/d)^(p+1), which is 1 · (R/d)³ at
 *   p = 2. So moving the gravity exponent really does re-shape the planet.
 *
 * Both are tiny in reality — a few parts per thousand — so the renderer exaggerates
 * them by the same factor it exaggerates relief. The physics always uses true values.
 */

export interface Figure {
  /** (a − c)/a, rotational flattening */
  flattening: number
  /** rotational parameter m = Ω²R³/GM */
  rotParam: number
  /** per-body tidal amplitude in km, and the unit vector toward each body */
  tides: { amplitudeKm: number, dir: [number, number, number], name: string }[]
  /** largest tidal amplitude, km, and the direction it points */
  peakTideKm: number
  peakTideDir: [number, number, number]
  /** equatorial and polar radius, km */
  equatorialKm: number
  polarKm: number
}

/** Symmetric radial strain: xx, yy, zz, xy, xz, yz. Rotation stays about +Y;
 * each moon contributes independently, even when its orbit is inclined. */
export function equilibriumStrain(fig: Figure, out: Float64Array = new Float64Array(6)): Float64Array {
  out.fill(0)
  out[1] = -fig.flattening
  for (const tide of fig.tides) {
    const a = tide.amplitudeKm / PLANET_RADIUS_KM
    const [x, y, z] = tide.dir
    out[0] = out[0]! + (a * (1.5 * x * x - 0.5))
    out[1] = out[1]! + (a * (1.5 * y * y - 0.5))
    out[2] = out[2]! + (a * (1.5 * z * z - 0.5))
    out[3] = out[3]! + (a * 1.5 * x * y)
    out[4] = out[4]! + (a * 1.5 * x * z)
    out[5] = out[5]! + (a * 1.5 * y * z)
  }
  return out
}

/** A phenomenological rocky-body response, measured in simulation days, not
 * rendered frames. Daily forcing is filtered instead of kneading the whole planet. */
export function relaxStrain(strain: Float64Array, target: Float64Array, laws: Laws, dt: number): void {
  const tau = laws.shapeRelaxationDays! * laws.rotationPeriod!
  const alpha = -Math.expm1(-dt / Math.max(1, tau))
  for (let i = 0; i < 6; i++) strain[i] = strain[i]! + ((target[i]! - strain[i]!) * alpha)
}

export function strainOffsetKm(s: Float64Array, x: number, y: number, z: number): number {
  return PLANET_RADIUS_KM * (s[0]! * x * x + s[1]! * y * y + s[2]! * z * z
    + 2 * (s[3]! * x * y + s[4]! * x * z + s[5]! * y * z))
}

export function computeFigure(bodies: Body[], laws: Laws, tick: number): Figure {
  const h2 = laws.loveNumberH2!
  const p = laws.gravityExponent!
  const m = rotationalParameter(laws)
  const flattening = (h2 / 2) * m

  // degree-2 tidal coefficient, reducing to 1 at the inverse-square law
  const tidalOrder = (p * (p + 1)) / 6

  const tides: Figure['tides'] = []
  let peak = 0
  let peakDir: [number, number, number] = [1, 0, 0]
  for (const b of bodies) {
    const d = Math.hypot(b.pos[0], b.pos[1], b.pos[2])
    if (!Number.isFinite(d) || d < 1e-6) continue
    // distances are already in planet radii, masses in planet masses
    const amplitudeKm = h2 * b.mass * tidalOrder * d ** (-(p + 1)) * PLANET_RADIUS_KM
    if (!Number.isFinite(amplitudeKm)) continue
    // the bulge must be expressed where the terrain is, i.e. co-rotating
    const dir = corotate(b.pos[0] / d, b.pos[1] / d, b.pos[2] / d, tick, laws)
    tides.push({ amplitudeKm, dir, name: b.name })
    if (amplitudeKm > peak) {
      peak = amplitudeKm
      peakDir = dir
    }
  }

  return {
    flattening,
    rotParam: m,
    tides,
    peakTideKm: peak,
    peakTideDir: peakDir,
    equatorialKm: PLANET_RADIUS_KM,
    polarKm: PLANET_RADIUS_KM * (1 - flattening)
  }
}

/**
 * Radial displacement of the equilibrium figure at a unit direction, in km.
 * The spin axis is +Y.
 */
export function figureOffsetKm(
  fig: Figure,
  x: number,
  y: number,
  z: number
): number {
  // rotational: r = R(1 − f·sin²φ), and sin φ is just the y component
  let d = -fig.flattening * PLANET_RADIUS_KM * y * y

  // tidal: ζ·P₂(cos θ) with P₂(u) = (3u² − 1)/2, prolate toward each body
  for (const t of fig.tides) {
    const u = x * t.dir[0] + y * t.dir[1] + z * t.dir[2]
    d += t.amplitudeKm * (3 * u * u - 1) * 0.5
  }
  return d
}

/** Fill a per-vertex displacement buffer. Cheap enough to redo as the moons move. */
export function fillFigureOffsets(
  fig: Figure,
  pos: Float32Array,
  count: number,
  out: Float32Array
): void {
  for (let v = 0; v < count; v++) {
    out[v] = figureOffsetKm(fig, pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!)
  }
}
