import type { Grid } from './icosphere'
import type { Air } from './air'
import { windTransport } from './air'

interface TransportCache {
  from: Int32Array
  to: Int32Array
  edge: Int32Array
  rate: Float64Array
  outgoing: Float64Array
  old: Float32Array
}

const caches = new WeakMap<Grid, TransportCache>()

/** Pairwise finite-volume transport on approximately equal-area geodesic cells.
 * Every outgoing transfer is received by its neighbour, including at converging
 * winds. Substeps bound total outgoing flux rather than clipping each edge's CFL.
 * The old pull-from-one-neighbour scheme erased material in convergence regions
 * and selected discontinuous directions as the wind crossed a triangle edge. */
export function transportTracers(grid: Grid, air: Pick<Air, 'windU' | 'windV'>, fields: Float32Array[], dt: number): void {
  let cache = caches.get(grid)
  if (!cache) {
    const from: number[] = [], to: number[] = [], edge: number[] = []
    for (let i = 0; i < grid.count; i++) {
      for (let k = grid.nbrStart[i]!; k < grid.nbrStart[i + 1]!; k++) {
        const j = grid.nbrList[k]!
        if (j > i) { from.push(i); to.push(j); edge.push(k) }
      }
    }
    cache = { from: Int32Array.from(from), to: Int32Array.from(to), edge: Int32Array.from(edge),
      rate: new Float64Array(from.length), outgoing: new Float64Array(grid.count), old: new Float32Array(grid.count) }
    caches.set(grid, cache)
  }
  const basis = windTransport(grid)
  const { from, to, edge, rate, outgoing, old } = cache
  outgoing.fill(0)
  for (let e = 0; e < from.length; e++) {
    const i = from[e]!, j = to[e]!, k = edge[e]!
    const u = (air.windU[i]! + air.windU[j]! * basis[k * 4]! + air.windV[j]! * basis[k * 4 + 1]!) * 0.5
    const v = (air.windV[i]! + air.windU[j]! * basis[k * 4 + 2]! + air.windV[j]! * basis[k * 4 + 3]!) * 0.5
    const degrees = grid.nbrStart[i + 1]! - grid.nbrStart[i]! + grid.nbrStart[j + 1]! - grid.nbrStart[j]!
    const flux = (u * grid.nbrU[k]! + v * grid.nbrV[k]!) * 8 / (degrees * grid.nbrLen[k]!)
    rate[e] = flux
    const donor = flux > 0 ? i : j
    outgoing[donor] = outgoing[donor]! + Math.abs(flux)
  }
  let max = 0
  for (const x of outgoing) max = Math.max(max, x)
  const steps = Math.max(1, Math.ceil(max * dt / 0.8))
  const h = dt / steps
  for (let step = 0; step < steps; step++) {
    for (const field of fields) {
      old.set(field)
      for (let e = 0; e < from.length; e++) {
        const i = from[e]!, j = to[e]!, r = rate[e]!
        const amount = h * r * old[r > 0 ? i : j]!
        field[i] = field[i]! - amount
        field[j] = field[j]! + amount
      }
    }
  }
}
