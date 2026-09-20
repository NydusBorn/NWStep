import type { World, Body } from './world'
import type { Air } from './air'
import type { Clouds } from './clouds'
import { computeFigure } from './shape'

/** Complete checkpoints include weather, bodies and the slowly evolving solid
 * figure. Float32 copies preserve solver precision during rewind/replay. */
export interface Snapshot {
  tick: number
  air: Air
  clouds: Clouds
  bodies: Body[]
  strain: Float64Array
  escaped: string[]
}

export interface History {
  stride: number
  capacity: number
  frames: Snapshot[]
}

export function createHistory(stride = 4, capacity = 260): History {
  return { stride, capacity, frames: [] }
}

export function historySpan(h: History): { from: number, to: number } | null {
  if (!h.frames.length) return null
  return { from: h.frames[0]!.tick, to: h.frames[h.frames.length - 1]!.tick }
}

export function record(h: History, world: World, force = false): void {
  if (!force && world.tick % h.stride !== 0) return
  while (h.frames.length && h.frames[h.frames.length - 1]!.tick > world.tick) h.frames.pop()
  if (h.frames[h.frames.length - 1]?.tick === world.tick) return
  h.frames.push({
    tick: world.tick,
    air: structuredClone(world.air),
    clouds: structuredClone(world.clouds),
    bodies: world.bodies.map(b => ({ ...b, pos: [...b.pos], vel: [...b.vel], trail: [] })),
    strain: world.strain.slice(),
    escaped: [...world.escaped]
  })
  while (h.frames.length > h.capacity) h.frames.shift()
}

export function findFrame(h: History, tick: number): Snapshot | null {
  for (let i = h.frames.length - 1; i >= 0; i--) {
    if (h.frames[i]!.tick <= tick) return h.frames[i]!
  }
  return null
}

export function restore(world: World, snap: Snapshot): void {
  world.air = structuredClone(snap.air)
  world.clouds = structuredClone(snap.clouds)
  world.bodies = structuredClone(snap.bodies)
  world.strain.set(snap.strain)
  world.escaped = [...snap.escaped]
  world.tick = snap.tick
  world.figure = computeFigure(world.bodies, world.laws, world.tick)
  world.paused = false
}

export function clearHistory(h: History): void {
  h.frames.length = 0
}
