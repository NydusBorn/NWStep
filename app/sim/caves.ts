import type { Sphere } from './icosphere'
import type { Terrain } from './terrain'
import type { Laws } from './laws'
import { mulberry32 } from './noise'

/**
 * CAVERN SYSTEMS.
 *
 * Caves act on the wind locally, not globally, and they do two distinct things:
 *
 *   TRAPPING. A cavernous cell holds a reservoir of air that the surface wind has to
 *   drag past a great deal of rock. It is a momentum sink: flow entering it slows and
 *   stalls, which is why the lee of a karst field is calm while the ridge above it is
 *   not. In the solver this is extra drag proportional to how cavernous the cell is.
 *
 *   BUFFERING. Rock is thermally massive and a cave is shielded from the sky, so a
 *   cavern barely notices the day/night swing that whips the open surface. That is a
 *   larger local thermal inertia, and because pressure here is built from temperature,
 *   a field of caves becomes a patch of steady pressure the weather flows around.
 *
 *   CONDUITS. Two chambers joined by a tunnel short-circuit the surface: when there is
 *   a pressure difference between their mouths, air moves through the rock rather than
 *   over it, carrying heat with it. This is what makes a cave system a shortcut through
 *   an obstacle instead of only a hole in the ground.
 *
 * Caves are placed where the rock is most broken -- the roughest ground -- because that
 * is where fracturing and chemical attack open passages in the first place.
 */

export interface Caves {
  /** per sim cell, 0..1: how cavernous it is */
  intensity: Float32Array
  /** tunnel endpoints, two cell indices per tunnel */
  links: Int32Array
  /** number of tunnels */
  count: number
  /** how many cells are cavernous at all, for the readout */
  cells: number
}

/** Systems per unit of the caveDensity law. */
const SYSTEMS_PER_DENSITY = 45
/** Candidate draws per system when picking a rough starting point. */
const SITE_TRIES = 14
/** Chance a neighbouring cell is drawn into the same chamber network. */
const SPREAD_CHANCE = 0.55

export function generateCaves(
  sphere: Sphere,
  terrain: Terrain,
  laws: Laws,
  seed: number
): Caves {
  const { grid } = sphere
  const n = grid.count
  const intensity = new Float32Array(n)
  const rnd = mulberry32(seed ^ 0x1b873593)
  const systems = Math.round(laws.caveDensity! * SYSTEMS_PER_DENSITY)
  const links: number[] = []

  const queue: number[] = []
  const seen = new Set<number>()

  for (let s = 0; s < systems; s++) {
    // fracturing and chemical attack open passages in broken rock, so bias the
    // starting point toward the roughest ground rather than scattering uniformly
    let start = 0
    let best = -1
    for (let t = 0; t < SITE_TRIES; t++) {
      const c = Math.floor(rnd() * n)
      const w = terrain.roughness[c]! * rnd()
      if (w > best) { best = w; start = c }
    }

    const size = 4 + Math.floor(rnd() * 10)
    queue.length = 0
    seen.clear()
    queue.push(start)
    seen.add(start)
    let far = start

    for (let k = 0; k < size && queue.length; k++) {
      const c = queue.shift()!
      // deepest at the heart of the system, thinning toward its edges
      intensity[c] = Math.min(1, intensity[c]! + (1 - k / size))
      far = c
      for (let e = grid.nbrStart[c]!; e < grid.nbrStart[c + 1]!; e++) {
        const j = grid.nbrList[e]!
        if (!seen.has(j) && rnd() < SPREAD_CHANCE) {
          seen.add(j)
          queue.push(j)
        }
      }
    }

    // a tunnel between the two ends of the network, so it can short-circuit whatever
    // lies between them
    if (far !== start) links.push(start, far)
  }

  let cells = 0
  for (let i = 0; i < n; i++) if (intensity[i]! > 0.01) cells++

  return { intensity, links: new Int32Array(links), count: links.length / 2, cells }
}
