import type { Sphere } from './icosphere'
import type { Laws } from './laws'
import { Simplex, mulberry32 } from './noise'
import { planetRadiusKm, rotationalParameter } from './units'

export interface Terrain {
  /** render-resolution elevation in km */
  elev: Float32Array
  /** sim-resolution elevation in km (the sim cells are a prefix of the render set) */
  elevSim: Float32Array
  /** sim-resolution slope magnitude, normalised to 0..1 */
  roughness: Float32Array
  /** sim-resolution elevation gradient in the local (east, north) basis, km per unit length */
  gradU: Float32Array
  gradV: Float32Array
  min: number
  max: number
}

/**
 * Terrain generation for a barren, rocky, cratered world. No ocean, no vegetation —
 * this is a Mars-like surface, as plan.md describes: strongly rocky, relief to 100 km.
 *
 *   plates   -> boundary belts, so mountains form in LINES not blobs
 *   Euler poles -> what each stretch of boundary DOES: collide, rift, or slide
 *   rotation -> where those belts are strongest (real centrifugal stress by latitude)
 *   ridged multifractal + domain warp -> the detail inside a belt
 *   impacts  -> bowls with raised rims, from a power-law size distribution
 *   erosion  -> blends sharp ridges toward their low-frequency envelope
 *
 * The linear ranges and the crater rims matter equally: both are what the wind has to
 * flow around, and coherent obstacles are what produce coherent streams.
 */

/** Rotational parameter of the default law set (a tidally locked, fast rotator).
 *  The spin-orogeny coefficient is expressed relative to this so its slider reads 1
 *  at the baseline world rather than in raw units of m. */
const REF_ROT_PARAM = 0.0177

/**
 * Convergence rate that counts as a fully developed collision. Relative plate speeds
 * are O(drift), so this sets where the uplift response saturates. Low enough that a
 * genuinely colliding segment reaches full uplift -- set too high and every belt is
 * only part-built, which flattens the whole world instead of putting gaps in it.
 */
const CONVERGENCE_REF = 0.15

/**
 * Ridged multifractal sums (1-|noise|)^2 over several octaves and so almost never
 * approaches zero -- its floor sits near 0.4. A belt built straight from it therefore
 * has no bare stretches. Rescaling from this floor gives the noise genuine zeros, and
 * genuine zeros are gaps.
 */
const RIDGE_FLOOR = 0.3

/** Simple-crater morphometry: depth is a few percent of diameter at basin scale
 *  (Hellas is ~7 km deep and 2300 km across), and the rim is a fraction of that. */
const DEPTH_PER_DIAMETER = 0.03
const MAX_DEPTH_KM = 14
const RIM_FRACTION = 0.3
const RIM_WIDTH = 0.34

export function generateTerrain(sphere: Sphere, laws: Laws, seed: number): Terrain {
  const { grid, mesh } = sphere
  const simplex = new Simplex(seed)
  const warpNoise = new Simplex(seed ^ 0x9e3779b9)
  const rnd = mulberry32(seed ^ 0x5bf03635)

  // --- plates: a seed, and an Euler pole it rotates about ----------------------
  // Real plates move as rigid rotations of the sphere, so the relative motion across
  // a boundary is itself a rotation about the pair's relative Euler pole. Its size and
  // its angle to the boundary therefore vary ALONG the boundary, which is what makes a
  // single belt convergent in one stretch and merely transform in the next.
  const plateCount = Math.max(3, Math.round(laws.plateCount!))
  const plates = new Float32Array(plateCount * 3)
  const omega = new Float32Array(plateCount * 3)
  const drift = laws.plateDrift!
  for (let i = 0; i < plateCount; i++) {
    const z = rnd() * 2 - 1
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    plates[i * 3] = r * Math.cos(a)
    plates[i * 3 + 1] = z
    plates[i * 3 + 2] = r * Math.sin(a)

    const ez = rnd() * 2 - 1
    const ea = rnd() * Math.PI * 2
    const er = Math.sqrt(1 - ez * ez)
    const rate = (rnd() * 2 - 1) * drift
    omega[i * 3] = er * Math.cos(ea) * rate
    omega[i * 3 + 1] = ez * rate
    omega[i * 3 + 2] = er * Math.sin(ea) * rate
  }

  // --- impact population -------------------------------------------------------
  // Real crater counts follow roughly N(>D) ∝ D^-2, so sampling radius as
  // rMin·u^(-1/2) reproduces "many small, few enormous".
  const craterCount = Math.round(laws.craterDensity! * 90)
  const craters = new Float32Array(craterCount * 5) // x, y, z, angular radius, depth km
  for (let i = 0; i < craterCount; i++) {
    const z = rnd() * 2 - 1
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    const u = Math.max(1e-3, rnd())
    const ang = Math.min(0.42, 0.022 * u ** -0.5)
    const diameterKm = 2 * ang * planetRadiusKm(laws)
    craters[i * 5] = r * Math.cos(a)
    craters[i * 5 + 1] = z
    craters[i * 5 + 2] = r * Math.sin(a)
    craters[i * 5 + 3] = ang
    craters[i * 5 + 4] = Math.min(MAX_DEPTH_KM, DEPTH_PER_DIAMETER * diameterKm)
  }

  const amp = laws.reliefAmplitude!
  const uplift = laws.upliftRate!
  const erosion = laws.erosionRate!
  const riftDepth = laws.riftDepth!
  const datum = laws.datumLevel!

  // real centrifugal stress, normalised so the slider reads 1 at baseline spin
  const stressAmp = laws.spinOrogeny! * (rotationalParameter(laws) / REF_ROT_PARAM)

  const elev = new Float32Array(mesh.count)
  let min = Infinity, max = -Infinity

  for (let v = 0; v < mesh.count; v++) {
    const x = mesh.pos[v * 3]!, y = mesh.pos[v * 3 + 1]!, z = mesh.pos[v * 3 + 2]!

    // nearest and second-nearest plate seed
    let d1 = Infinity, d2 = Infinity
    let i1 = 0, i2 = 0
    for (let p = 0; p < plateCount; p++) {
      const dx = x - plates[p * 3]!, dy = y - plates[p * 3 + 1]!, dz = z - plates[p * 3 + 2]!
      const d = dx * dx + dy * dy + dz * dz
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = p } else if (d < d2) { d2 = d; i2 = p }
    }
    // Close to a boundary when the two nearest seeds are almost equidistant.
    // Compare true distances and keep the falloff sharp -- a soft belt spreads
    // uplift over whole plates and the ranges dissolve back into noise.
    const gap = Math.sqrt(d2) - Math.sqrt(d1)
    const belt = Math.exp(-((gap * 9) ** 2))

    // continent-scale base relief
    const base = simplex.fbm(x * 1.15, y * 1.15, z * 1.15, 5)

    // domain warp bends ridges so they meander like real ranges
    const wx = warpNoise.noise(x * 2.1, y * 2.1, z * 2.1) * 0.3
    const wy = warpNoise.noise(y * 2.1 + 5.2, z * 2.1, x * 2.1) * 0.3
    const wz = warpNoise.noise(z * 2.1, x * 2.1 + 3.7, y * 2.1) * 0.3

    const sharp = simplex.ridged((x + wx) * 2.7, (y + wy) * 2.7, (z + wz) * 2.7, 6)
    const smooth = simplex.ridged((x + wx) * 1.1, (y + wy) * 1.1, (z + wz) * 1.1, 3)
    const ridgeRaw = sharp * (1 - erosion) + smooth * erosion
    const ridge = Math.max(0, (ridgeRaw - RIDGE_FLOOR) / (1 - RIDGE_FLOOR))

    // --- what kind of boundary is this? ----------------------------------------
    // v = ω × p for each plate; the component of their difference along the boundary
    // normal is the convergence rate. Positive builds mountains, negative opens a
    // rift, and near zero the plates are just sliding past one another.
    const vax = omega[i1 * 3 + 1]! * z - omega[i1 * 3 + 2]! * y
    const vay = omega[i1 * 3 + 2]! * x - omega[i1 * 3]! * z
    const vaz = omega[i1 * 3]! * y - omega[i1 * 3 + 1]! * x
    const vbx = omega[i2 * 3 + 1]! * z - omega[i2 * 3 + 2]! * y
    const vby = omega[i2 * 3 + 2]! * x - omega[i2 * 3]! * z
    const vbz = omega[i2 * 3]! * y - omega[i2 * 3 + 1]! * x

    // boundary normal: from one seed toward the other, with the radial part removed
    let nx = plates[i2 * 3]! - plates[i1 * 3]!
    let ny = plates[i2 * 3 + 1]! - plates[i1 * 3 + 1]!
    let nz = plates[i2 * 3 + 2]! - plates[i1 * 3 + 2]!
    const radial = nx * x + ny * y + nz * z
    nx -= radial * x; ny -= radial * y; nz -= radial * z
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl

    const conv = ((vax - vbx) * nx + (vay - vby) * ny + (vaz - vbz) * nz) / CONVERGENCE_REF
    const compress = Math.min(1, Math.max(0, conv))
    const extend = Math.min(1, Math.max(0, -conv))

    // centrifugal stress: extension at the equator, compression near 45 degrees
    const lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const stress = 1 + stressAmp * (Math.sin(2 * Math.abs(lat)) - 1 / 3)

    const mountains = ridge * belt * compress * Math.max(0, stress) * uplift
    const rift = belt * extend * riftDepth
    let h = (base * 0.34 + mountains * 0.66 - rift * 0.3) * amp - datum

    // --- impacts, carved on top of the tectonic surface ------------------------
    for (let c = 0; c < craterCount; c++) {
      const dx = x - craters[c * 5]!, dy = y - craters[c * 5 + 1]!, dz = z - craters[c * 5 + 2]!
      const chord = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const ang = craters[c * 5 + 3]!
      // 2·sin(θ/2) is the chord for angular separation θ; compare in chord space
      const reach = 2 * Math.sin(Math.min(Math.PI, ang * 2.2) / 2)
      if (chord > reach) continue
      const xr = (2 * Math.asin(Math.min(1, chord / 2))) / ang
      const depth = craters[c * 5 + 4]!
      if (xr < 1) h += depth * (xr * xr - 1)
      h += depth * RIM_FRACTION * Math.exp(-(((xr - 1) / RIM_WIDTH) ** 2))
    }

    elev[v] = h
    if (h < min) min = h
    if (h > max) max = h
  }

  // sim cells are exactly the first grid.count render vertices
  const elevSim = elev.subarray(0, grid.count) as Float32Array

  // --- slope and gradient on the sim grid --------------------------------------
  const gradU = new Float32Array(grid.count)
  const gradV = new Float32Array(grid.count)
  const roughness = new Float32Array(grid.count)
  let maxSlope = 1e-6

  for (let i = 0; i < grid.count; i++) {
    const s = grid.nbrStart[i]!, e = grid.nbrStart[i + 1]!
    let gu = 0, gv = 0
    for (let k = s; k < e; k++) {
      const j = grid.nbrList[k]!
      const dh = (elevSim[j]! - elevSim[i]!) / grid.nbrLen[k]!
      gu += dh * grid.nbrU[k]!
      gv += dh * grid.nbrV[k]!
    }
    const n = e - s
    gu = (gu * 2) / n
    gv = (gv * 2) / n
    gradU[i] = gu
    gradV[i] = gv
    const slope = Math.hypot(gu, gv)
    roughness[i] = slope
    if (slope > maxSlope) maxSlope = slope
  }
  for (let i = 0; i < grid.count; i++) roughness[i] = roughness[i]! / maxSlope

  return { elev, elevSim, roughness, gradU, gradV, min, max }
}
