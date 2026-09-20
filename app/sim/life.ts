import type { World } from './world'
import type { Grid } from './icosphere'

export interface Traits {
  efficiency: number
  metabolism: number
  windResponse: number
  frequency: number
  sociability: number
  positiveRate: number
}

export interface Colony {
  id: number
  parents: number[]
  mergedFrom?: number[]
  origin: 'founder' | 'descendant' | 'lightning' | 'merged'
  generation: number
  born: number
  lastBirth: number
  cell: number
  position: [number, number, number]
  positive: number
  negative: number
  energy: number
  phase: number
  traits: Traits
  fed: number
  cost: number
  crowding: number
  decision: string
}

export interface Life {
  colonies: Colony[]
  seeded: boolean
  rng: number
  nextId: number
  births: number
  lightningBirths: number
  artificialColonies: number
  lastLightningAttempt: number
  deaths: number
  starved: number
  crowded: number
  harvested: number
  merges: number
  contacts: Record<string, number>
  events: { tick: number, text: string }[]
}

export const population = (c: Colony) => c.positive + c.negative
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))

export function createLife(seed: number): Life {
  return { colonies: [], seeded: false, rng: (seed ^ 0x51f15e) >>> 0, nextId: 1,
    births: 0, lightningBirths: 0, artificialColonies: 0, lastLightningAttempt: -1,
    deaths: 0, starved: 0, crowded: 0, harvested: 0, merges: 0, contacts: {}, events: [] }
}

function random(life: Life): number {
  life.rng = (life.rng + 0x6d2b79f5) >>> 0
  let t = life.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function event(w: World, text: string) {
  w.life.events.push({ tick: w.tick, text })
  if (w.life.events.length > 24) w.life.events.shift()
}

export function habitat(w: World, i: number): number {
  const c = w.clouds.cloud[i]!, d = w.clouds.dust[i]!
  const cloud = c / (c + w.laws.lifeCloudScale!)
  return cloud + (1 - cloud) * w.laws.lifeDustEfficiency! * d / (d + w.laws.lifeDustScale!)
}

export function reserve(w: World, c: Colony): number {
  return population(c) * c.traits.metabolism * w.laws.lifeMaintenance! * w.laws.lifeReserveTicks!
}

export function colonyRadius(c: Colony): number {
  return Math.min(0.045, 0.008 + Math.sqrt(population(c)) * 0.002) / (1 + 0.3 * (1 + Math.sin(c.phase)))
}

function born(w: World, cell: number, count: number, traits: Traits, parents: Colony[] = []): Colony {
  const positive = rounded(w.life, count * traits.positiveRate)
  const c: Colony = {
    id: w.life.nextId++, parents: parents.map(p => p.id),
    origin: parents.length ? 'descendant' : 'founder',
    generation: parents.length ? 1 + Math.max(...parents.map(p => p.generation)) : 0,
    born: w.tick, lastBirth: w.tick, cell,
    position: Array.from(w.sphere.grid.pos.slice(cell * 3, cell * 3 + 3)) as [number, number, number],
    positive, negative: count - positive, energy: 0, phase: random(w.life) * Math.PI * 2,
    traits, fed: 0, cost: 0, crowding: 0, decision: 'Drifting'
  }
  return c
}

/** Manual introductions bypass warmup/density gates, never separation or capacity. */
export function seedColonies(w: World, requested?: number): number {
  const manual = requested !== undefined
  if (manual && (!Number.isFinite(requested) || requested! < 1)) return 0
  if (!manual && (w.life.seeded || !w.laws.lifeEnabled || w.tick < w.laws.lifeSeedDelay!)) return 0
  const initial = w.life.colonies.length
  const target = Math.min(Math.floor(requested ?? w.laws.lifeFounders!), Math.floor(w.laws.lifeMaxColonies!) - initial)
  if (target <= 0) return 0
  const g = w.sphere.grid
  const cells: { cell: number, density: number }[] = []
  for (let i = 0; i < g.count; i++) {
    const density = w.clouds.cloud[i]! / w.laws.lifeCloudScale! + w.clouds.dust[i]! / w.laws.lifeDustScale!
    // Dense but electrically inert ice cannot feed founders. Wait for at least
    // one tick's usable maintenance for a typical 32-creature founding group.
    const food = w.clouds.charge[i]! * habitat(w, i)
    if (manual || (density >= w.laws.lifeSeedDensity! && food >= w.laws.lifeMaintenance! * 32)) cells.push({ cell: i, density })
  }
  if (!manual && cells.length < target * 10) return 0
  cells.sort((a, b) => b.density - a.density || a.cell - b.cell)
  const rngBefore = w.life.rng
  const candidates = cells
  // Visit density bands from richest to poorest, randomising only within each
  // band. A single dense patch must not monopolise the whole founder batch.
  const band = Math.max(1, Math.ceil(cells.length * 0.1))
  for (let start = 0; start < candidates.length; start += band) {
    for (let i = Math.min(candidates.length, start + band) - 1; i > start; i--) {
      const j = start + Math.floor(random(w.life) * (i - start + 1))
      ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
    }
  }
  const selected: number[] = []
  for (const { cell } of candidates) {
    if (selected.length >= target) break
    const p = g.pos.subarray(cell * 3, cell * 3 + 3)
    if (w.life.colonies.some(c => c.position.reduce((sum, v, k) => sum + v * p[k]!, 0) > Math.cos(w.laws.lifeSeparation!))) continue
    if (selected.some(i => g.pos[i * 3]! * p[0]! + g.pos[i * 3 + 1]! * p[1]! + g.pos[i * 3 + 2]! * p[2]! > Math.cos(w.laws.lifeSeparation!))) continue
    selected.push(cell)
  }
  if (!manual && selected.length < target) {
    w.life.rng = rngBefore
    return 0
  }
  for (const cell of selected) {
    const traits: Traits = { efficiency: 0.8 + random(w.life) * 0.4, metabolism: 0.8 + random(w.life) * 0.4,
      windResponse: 0.8 + random(w.life) * 0.4, frequency: 0.1 + random(w.life) * 0.2,
      sociability: random(w.life), positiveRate: 0.15 + random(w.life) * 0.7 }
    const c = born(w, cell, 24 + Math.floor(random(w.life) * 17), traits)
    c.energy = reserve(w, c)
    w.life.colonies.push(c)
  }
  const created = w.life.colonies.length - initial
  if (created) {
    w.life.seeded = true
    w.life.artificialColonies += created
    event(w, `${created} colonies artificially introduced${manual ? ' by the observer' : ' after habitat warmup'}`)
  }
  return created
}

function nearest(g: Grid, p: number[], start: number): number {
  let cell = start
  const dot = (i: number) => p[0]! * g.pos[i * 3]! + p[1]! * g.pos[i * 3 + 1]! + p[2]! * g.pos[i * 3 + 2]!
  for (let step = 0; step < g.count; step++) {
    let best = cell, score = dot(cell)
    for (let k = g.nbrStart[cell]!; k < g.nbrStart[cell + 1]!; k++) {
      const j = g.nbrList[k]!, value = dot(j)
      if (value > score + 1e-12) { best = j; score = value }
    }
    if (best === cell) break
    cell = best
  }
  return cell
}

/** Move and index colonies, then return the electrical withdrawal callback.
 * All contenders in a cell receive the same fraction of their requested charge. */
export function prepareLife(w: World): ((cell: number, charge: number) => number) | undefined {
  if (!w.laws.lifeEnabled || !w.life.colonies.length) return undefined
  const g = w.sphere.grid, buckets = new Map<number, Colony[]>()
  const sensed = w.life.colonies.map(c => ({ ...c, position: [...c.position] as [number, number, number] }))
  for (const c of w.life.colonies) {
    c.fed = 0
    const i = c.cell, u = w.air.windU[i]!, v = w.air.windV[i]!, speed = Math.hypot(u, v)
    let voteU = 0, voteV = 0, weights = 1
    for (let k = g.nbrStart[i]!; k < g.nbrStart[i + 1]!; k++) {
      const j = g.nbrList[k]!, weight = Math.max(0, habitat(w, j) - habitat(w, i))
      voteU += weight * g.nbrU[k]!; voteV += weight * g.nbrV[k]!; weights += weight
    }
    // Social vote is local; opposite imbalances or phases favour separation.
    for (const other of sensed) {
      if (other.id === c.id || distance(c, other) > 0.12) continue
      const attraction = (compatibility(c, other) - 0.5) * c.traits.sociability
      for (let axis = 0; axis < 3; axis++) {
        const delta = other.position[axis]! - c.position[axis]!
        voteU += delta * g.east[i * 3 + axis]! * attraction
        voteV += delta * g.north[i * 3 + axis]! * attraction
      }
      weights += Math.abs(attraction)
    }
    const response = c.traits.windResponse / (1 + colonyRadius(c) * 10)
    const strength = w.laws.lifeSteering! * speed * response
    const norm = Math.max(weights, Math.hypot(voteU, voteV))
    const su = voteU / norm * strength, sv = voteV / norm * strength
    c.cost = population(c) * c.traits.metabolism * w.laws.lifeMaintenance! * (1 + Math.hypot(su, sv) / Math.max(1e-12, speed))
    c.decision = Math.hypot(su, sv) > speed * 0.001 ? 'Blending food and contact votes' : 'Drifting with wind'
    // Small spherical substeps prevent skipping narrow grid cells at high winds.
    const steps = Math.max(1, Math.ceil(speed * response / 0.015))
    for (let s = 0; s < steps; s++) {
      const cell = c.cell
      const localScale = Math.hypot(w.air.windU[cell]!, w.air.windV[cell]!) / Math.max(1e-12, speed)
      for (let axis = 0; axis < 3; axis++) {
        c.position[axis] = c.position[axis]! + ((w.air.windU[cell]! * response + su * localScale) * g.east[cell * 3 + axis]!
          + (w.air.windV[cell]! * response + sv * localScale) * g.north[cell * 3 + axis]!) / steps
      }
      const length = Math.hypot(...c.position)
      c.position = c.position.map(x => x / length) as [number, number, number]
      c.cell = nearest(g, c.position, cell)
    }
    c.phase = (c.phase + c.traits.frequency) % (2 * Math.PI)
    const list = buckets.get(c.cell) ?? []
    list.push(c); buckets.set(c.cell, list)
  }
  return (cell, charge) => {
    const colonies = buckets.get(cell)
    if (!colonies) return 0
    const quality = habitat(w, cell)
    if (quality <= 0) return 0
    const requests = colonies.map(c => Math.min(Math.max(0, reserve(w, c) - c.energy + c.cost), c.cost * w.laws.lifeHarvest!))
    const total = requests.reduce((a, b) => a + b, 0)
    const drawn = Math.min(charge, total)
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i]!
      const gain = total > 0 ? drawn * requests[i]! / total * clamp(quality * c.traits.efficiency) : 0
      c.energy += gain; c.fed += gain; w.life.harvested += gain
    }
    return drawn
  }
}

function distance(a: Colony, b: Colony): number {
  return Math.hypot(...a.position.map((x, k) => x - b.position[k]!))
}

export function compatibility(a: Colony, b: Colony): number {
  const phase = (1 + Math.cos(a.phase - b.phase)) / 2
  const balanceA = (a.positive - a.negative) / Math.max(1, population(a))
  const balanceB = (b.positive - b.negative) / Math.max(1, population(b))
  return phase * (1 - Math.abs(balanceA - balanceB) / 2)
}

function remove(c: Colony, count: number, life: Life): void {
  const n = population(c), lost = Math.min(n, Math.max(0, count))
  if (!lost) return
  const plus = n ? Math.min(c.positive, rounded(life, lost * c.positive / n)) : 0
  c.positive -= plus; c.negative -= lost - plus
}

function rounded(life: Life, x: number): number {
  return Math.floor(x) + (random(life) < x % 1 ? 1 : 0)
}

export function childTraits(w: World, parents: Colony[]): Traits {
  const result = { ...parents[0]!.traits }
  for (const key of Object.keys(result) as (keyof Traits)[]) {
    const mean = parents.reduce((sum, p) => sum + p.traits[key], 0) / parents.length
    const variation = (random(w.life) * 2 - 1) * w.laws.lifeMutation!
    result[key] = key === 'positiveRate'
      ? clamp(mean + variation)
      : clamp(mean * (1 + variation), key === 'sociability' ? 0 : key === 'frequency' ? 0.03 : key === 'efficiency' ? 0.02 : 0.1,
          key === 'sociability' ? 1 : key === 'metabolism' ? 8 : 2)
  }
  return result
}

function reproduce(w: World, parents: Colony[]): void {
  const first = parents[0]!, g = w.sphere.grid
  const candidates = Array.from(g.nbrList.slice(g.nbrStart[first.cell]!, g.nbrStart[first.cell + 1]!))
  candidates.sort((a, b) => habitat(w, b) - habitat(w, a) || a - b)
  const cell = candidates[0] ?? first.cell
  if (habitat(w, cell) < 0.05) return
  let count = 0, energy = 0
  for (const p of parents) {
    const contribution = Math.floor(population(p) * (parents.length > 1 ? 0.2 : 0.35))
    const share = contribution / population(p)
    energy += p.energy * share; p.energy *= 1 - share
    count += contribution; remove(p, contribution, w.life); p.lastBirth = w.tick
  }
  const c = born(w, cell, count, childTraits(w, parents), parents)
  c.energy = energy
  w.life.colonies.push(c); w.life.births++
  event(w, `Colony ${c.id} born from ${c.parents.join(' + ')} (generation ${c.generation})`)
}

export function finishLife(w: World): void {
  if (!w.laws.lifeEnabled) return
  seedColonies(w)
  seedFromLightning(w)
  const life = w.life, g = w.sphere.grid
  const occupancy = new Float64Array(g.count)
  for (const c of life.colonies) occupancy[c.cell] = occupancy[c.cell]! + population(c)
  for (const c of life.colonies) {
    // Newly introduced founders begin with their artificial reserve untouched.
    if (c.born === w.tick) continue
    c.energy = Math.max(0, c.energy - c.cost)
    let nearby = occupancy[c.cell]!
    for (let k = g.nbrStart[c.cell]!; k < g.nbrStart[c.cell + 1]!; k++) nearby += occupancy[g.nbrList[k]!]! * 0.15
    const capacity = Math.max(1, w.laws.lifeCapacity! * Math.max(0.25, habitat(w, c.cell)))
    c.crowding = Math.max(0, nearby / capacity - 1)
    const crowded = Math.min(population(c), rounded(life, population(c) * -Math.expm1(-w.laws.lifeCrowding! * c.crowding)))
    remove(c, crowded, life); life.crowded += crowded
    if (c.energy <= 0) {
      const starved = Math.min(population(c), Math.max(1, Math.ceil(population(c) / w.laws.lifeReserveTicks!)))
      remove(c, starved, life); life.starved += starved
    }
    if (population(c) && c.energy > reserve(w, c) * 0.6 && !c.crowding) {
      const birthCost = w.laws.lifeMaintenance! * c.traits.metabolism * w.laws.lifeReserveTicks! * 0.5
      const count = Math.min(Math.floor(c.energy * 0.15 / birthCost), rounded(life, population(c) * w.laws.lifeGrowth! * habitat(w, c.cell)))
      const plus = rounded(life, count * c.traits.positiveRate)
      c.positive += plus; c.negative += count - plus; c.energy -= count * birthCost
    }
    c.energy = Math.min(c.energy, reserve(w, c))
  }
  for (const c of life.colonies) {
    if (!population(c)) { life.deaths++; event(w, `Colony ${c.id} died`) }
  }
  life.colonies = life.colonies.filter(c => population(c) > 0)
  const adults = [...life.colonies]
  const absorbed = new Set<number>()
  const contacts: Record<string, number> = {}
  const ready = (c: Colony) => population(c) >= w.laws.lifeSplitPopulation! && c.energy >= reserve(w, c) * 0.6
    && w.tick - c.lastBirth >= w.laws.lifeGenerationDays! * w.laws.rotationPeriod!
  for (let i = 0; i < adults.length; i++) {
    const a = adults[i]!
    if (absorbed.has(a.id)) continue
    for (let j = i + 1; j < adults.length; j++) {
      const b = adults[j]!
      if (absorbed.has(b.id)) continue
      if (distance(a, b) > colonyRadius(a) + colonyRadius(b)) continue
      const match = compatibility(a, b)
      if (match < 0.6) {
        const loss = w.laws.lifeContactLoss! * (1 - match)
        a.energy *= 1 - loss; b.energy *= 1 - loss
      } else {
        const key = [a.id, b.id].sort((x, y) => x - y).join(':')
        contacts[key] = (life.contacts[key] ?? 0) + 1
        if (contacts[key]! >= w.laws.lifeMergeTicks!) {
          mergeColonies(w, a, b)
          absorbed.add(a.id); absorbed.add(b.id)
          break
        }
        const total = a.energy + b.energy
        const share = population(a) / (population(a) + population(b))
        // Gradual cooperative sharing, exactly conserving the pair's stored energy.
        const transfer = (total * share - a.energy) * 0.1
        a.energy += transfer; b.energy -= transfer
        if (ready(a) && ready(b) && life.colonies.length < w.laws.lifeMaxColonies!) reproduce(w, [a, b])
      }
    }
  }
  life.colonies = life.colonies.filter(c => !absorbed.has(c.id))
  life.contacts = Object.fromEntries(Object.entries(contacts).filter(([key]) => !key.split(':').some(id => absorbed.has(Number(id)))))
  for (const c of adults) {
    if (!absorbed.has(c.id) && ready(c) && life.colonies.length < w.laws.lifeMaxColonies!) reproduce(w, [c])
  }
}

/** Weighted traits describe the joined population; merging does not mutate traits. */
function mergeColonies(w: World, a: Colony, b: Colony): void {
  const nA = population(a), nB = population(b), total = nA + nB
  const traits = { ...a.traits }
  for (const key of Object.keys(traits) as (keyof Traits)[]) traits[key] = (a.traits[key] * nA + b.traits[key] * nB) / total
  const position = a.position.map((v, k) => (v * nA + b.position[k]! * nB) / total) as [number, number, number]
  const length = Math.hypot(...position)
  for (let k = 0; k < 3; k++) position[k] = position[k]! / length
  const merged: Colony = {
    ...a, id: w.life.nextId++, parents: [...new Set([...a.parents, ...b.parents])], mergedFrom: [a.id, b.id],
    origin: 'merged',
    generation: Math.max(a.generation, b.generation), born: w.tick, lastBirth: w.tick,
    traits, position, cell: nearest(w.sphere.grid, position, a.cell),
    positive: a.positive + b.positive, negative: a.negative + b.negative,
    energy: a.energy + b.energy, fed: a.fed + b.fed, cost: a.cost + b.cost,
    phase: Math.atan2(nA * Math.sin(a.phase) + nB * Math.sin(b.phase), nA * Math.cos(a.phase) + nB * Math.cos(b.phase)),
    decision: 'Joined a compatible colony'
  }
  w.life.colonies.push(merged)
  w.life.merges++
  event(w, `Colonies ${a.id} + ${b.id} merged into ${merged.id}`)
}

/** This tick's real breakdowns only; historical rendered bolts cannot spawn life. */
export function lightningBirthChance(w: World): number {
  if (!w.laws.lifeEnabled || !w.life.seeded || !w.clouds.flashes.length
    || w.life.colonies.length >= w.laws.lifeMaxColonies!) return 0
  const count = w.life.colonies.reduce((sum, c) => sum + population(c), 0)
  const suppression = (1 + count / w.laws.lifeSpontaneousScale!) ** 2
  const perStrike = w.laws.lifeSpontaneousChance! / suppression
  return Math.min(w.laws.lifeSpontaneousCap! / suppression,
    -Math.expm1(w.clouds.flashes.length * Math.log1p(-perStrike)))
}

export function seedFromLightning(w: World): void {
  if (w.life.lastLightningAttempt === w.tick) return
  const chance = lightningBirthChance(w)
  if (chance <= 0) return
  w.life.lastLightningAttempt = w.tick
  if (random(w.life) >= chance) return
  const cell = w.clouds.flashes[Math.floor(random(w.life) * w.clouds.flashes.length)]!
  // No fitness selection: poor feeding and ruinous metabolism are possible.
  const traits: Traits = {
    efficiency: 0.02 + random(w.life) * 1.98,
    metabolism: 0.1 + random(w.life) * 7.9,
    windResponse: 0.1 + random(w.life) * 1.9,
    frequency: 0.03 + random(w.life) * 1.97,
    sociability: random(w.life), positiveRate: random(w.life)
  }
  const c = born(w, cell, 1 + Math.floor(random(w.life) * 3), traits)
  c.origin = 'lightning'
  c.decision = 'Formed in a natural lightning discharge'
  c.energy = Math.min(w.clouds.charge[cell]!, reserve(w, c) * random(w.life) * 0.25)
  w.clouds.charge[cell] = Math.max(0, w.clouds.charge[cell]! - c.energy)
  w.clouds.maxCharge = w.clouds.charge.reduce((max, q) => Math.max(max, q), 1e-9)
  w.life.colonies.push(c)
  w.life.lightningBirths++
  event(w, `Lightning formed colony ${c.id} with ${population(c)} creatures`)
}
