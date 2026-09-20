/**
 * Physical scale of the world, and the conversions between simulation units and SI.
 *
 * These are not laws — they are the dimensions the laws are expressed against.
 * Simulation units: length = 1 planet radius, time = 1 tick.
 */

import type { Laws } from './laws'

/** Planet radius. plan.md: strongly rocky world with relief up to 100 km. */
export const PLANET_RADIUS_M = 6.0e6
export const PLANET_RADIUS_KM = PLANET_RADIUS_M / 1000

/** One tick is 15 simulated minutes. */
export const TICK_SECONDS = 900

/** Newton's constant. The law `G` is a dimensionless multiplier on top of it, so
 *  G = 1 means "real gravity" and G = 2 means "gravity twice as strong". */
export const G_SI = 6.674e-11

/** A year is this many rotations. plan.md puts the year at about ten days. */
export const DAYS_PER_YEAR = 10

export function planetRadiusKm(laws: Laws): number {
  return laws.planetRadiusKm ?? PLANET_RADIUS_KM
}

export function stellarFlux(laws: Laws): number {
  return laws.solarConstant! / (laws.starDistance ?? 1) ** 2
}

/** Circular stellar orbit relative to the original ten-day year, independent of spin. */
export function yearTicks(laws: Laws): number {
  return 50.27 * DAYS_PER_YEAR * (laws.starDistance ?? 1) ** 1.5 / Math.sqrt(laws.G!)
}

/** Legacy orbital calibration; density scales GM/R³, while radius cancels. */
export function orbitalGravity(laws: Laws): number {
  return laws.G! * laws.planetDensity! / 3900
}

export function planetMass(laws: Laws): number {
  return (4 / 3) * Math.PI * (planetRadiusKm(laws) * 1000) ** 3 * laws.planetDensity!
}

/** GM, with the player's gravitational multiplier applied. */
export function gravitationalParameter(laws: Laws): number {
  return laws.G! * G_SI * planetMass(laws)
}

export function surfaceGravity(laws: Laws): number {
  return gravitationalParameter(laws) / (planetRadiusKm(laws) * 1000) ** 2
}

/** Angular velocity in rad/s, from the rotation period in ticks. */
export function angularVelocity(laws: Laws): number {
  return (2 * Math.PI) / (Math.max(1, laws.rotationPeriod!) * TICK_SECONDS)
}

/**
 * The rotational parameter m = ω²R³ / GM: the ratio of centrifugal to gravitational
 * acceleration at the equator. This one number drives the planet's oblateness and,
 * through the stress field it implies, where mountain belts form.
 *
 * Earth's value is about 3.45e-3.
 */
export function rotationalParameter(laws: Laws): number {
  const w = angularVelocity(laws)
  return (w * w * (planetRadiusKm(laws) * 1000) ** 3) / gravitationalParameter(laws)
}

/** Simulation velocity (planet radii per tick) -> metres per second. */
export function toMetresPerSecond(v: number, laws?: Laws): number {
  return (v * (laws ? planetRadiusKm(laws) * 1000 : PLANET_RADIUS_M)) / TICK_SECONDS
}

/**
 * Beaufort wind force number from speed in m/s: B = (v / 0.836)^(2/3).
 * This is the real empirical scale, and it is what the streamline colours use —
 * it compresses the huge dynamic range of wind speed the way a human reads it.
 */
export function beaufort(metresPerSecond: number): number {
  return Math.cbrt((metresPerSecond / 0.836) ** 2)
}

/**
 * Rotate an inertial direction into the planet's co-rotating frame.
 *
 * The renderer holds the planet still and moves the sky, which is the co-rotating
 * frame. Everything in the sky must therefore be transformed the same way, or the
 * moons and the star disagree about which way the world turns -- and the tidal bulge,
 * which follows the moon, sweeps across the ground when it should be standing still.
 */
export function corotate(
  x: number, y: number, z: number, tick: number, laws: Laws
): [number, number, number] {
  const theta = -(2 * Math.PI * tick) / Math.max(1, laws.rotationPeriod!)
  const c = Math.cos(theta), s = Math.sin(theta)
  return [x * c - z * s, y, x * s + z * c]
}

/**
 * Orbital period of a circular orbit of radius r, in ticks.
 * For F = G·M/r^p the circular condition gives v = sqrt(GM/r^(p-1)), so
 * T = 2πr/v = 2π·sqrt(r^(p+1)/GM). At p = 2 this is Kepler's third law.
 */
export function orbitalPeriod(r: number, laws: Laws): number {
  const gm = orbitalGravity(laws)
  if (gm <= 0) return Infinity
  return 2 * Math.PI * Math.sqrt(r ** (laws.gravityExponent! + 1) / gm)
}

export interface Clock {
  totalHours: number
  day: number
  hour: number
  minute: number
  /** fraction through the current rotation, 0..1 */
  phase: number
}

export function clockOf(tick: number, laws: Laws): Clock {
  const period = Math.max(1, laws.rotationPeriod!)
  // Integer target ticks can land within floating-point roundoff of a day boundary.
  const rotations = tick / period + 1e-10
  const day = Math.floor(rotations)
  const phase = rotations - day
  const hoursPerDay = (period * TICK_SECONDS) / 3600
  const hourFloat = phase * hoursPerDay
  return {
    totalHours: (tick * TICK_SECONDS) / 3600,
    day,
    hour: Math.floor(hourFloat),
    minute: Math.floor((hourFloat % 1) * 60),
    phase
  }
}
