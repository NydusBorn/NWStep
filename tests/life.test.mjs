import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { createWorld, stepWorld, resetHistory } = require('../app/sim/world.ts')
const { createLife, seedColonies, prepareLife, finishLife, population, reserve, childTraits, lightningBirthChance, seedFromLightning } = require('../app/sim/life.ts')
const { restore, findFrame } = require('../app/sim/history.ts')
const { createFastForward, advanceFastForward } = require('../app/sim/fastForward.ts')
const { stepClouds } = require('../app/sim/clouds.ts')

function habitatWorld() {
  const w = createWorld()
  w.laws.lifeSeedDelay = 0
  w.clouds.cloud.fill(0.001)
  w.clouds.charge.fill(1)
  seedColonies(w)
  return w
}

test('founders wait for habitat and repeat with minimum separation', () => {
  const empty = createWorld()
  seedColonies(empty)
  assert.equal(empty.life.seeded, false)
  const a = habitatWorld(), b = habitatWorld()
  assert.deepEqual(a.life, b.life)
  assert.equal(a.life.colonies.length, a.laws.lifeFounders)
  for (const c of a.life.colonies) {
    for (const d of a.life.colonies) {
      if (c.id >= d.id) continue
      const dot = c.position.reduce((s, v, k) => s + v * d.position[k], 0)
      assert.ok(dot <= Math.cos(a.laws.lifeSeparation) + 1e-7)
    }
  }
  const dense = createWorld()
  dense.laws.lifeSeedDelay = 0
  dense.clouds.dust.fill(0.1)
  dense.clouds.charge.fill(1)
  for (let i = 0; i < 1100; i++) dense.clouds.dust[i] = 5
  seedColonies(dense)
  assert.ok(dense.life.colonies.length > 0)
  assert.ok(dense.life.colonies.every(c => c.cell < 1100))
})

test('cloud feeding beats dust and withdrawal competes with lightning', () => {
  const run = (cloud) => {
    const w = habitatWorld(), c = w.life.colonies[0]
    w.life.colonies = [c]
    w.clouds.cloud.fill(cloud ? 0.001 : 0)
    w.clouds.dust.fill(cloud ? 0 : 4)
    c.energy = 0
    const drawn = prepareLife(w)(c.cell, 0.001)
    assert.ok(c.fed <= drawn && drawn <= 0.001)
    return c.fed
  }
  assert.ok(run(true) > run(false) * 2)
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c, { ...structuredClone(c), id: 999 }]
  for (const colony of w.life.colonies) colony.energy = 0
  const drawn = prepareLife(w)(c.cell, 0.001)
  assert.ok(w.life.colonies.reduce((s, colony) => s + colony.fed, 0) <= drawn)
  assert.equal(w.life.colonies[0].fed, w.life.colonies[1].fed)
  w.clouds.charge.fill(2)
  stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 1, w.tick, (i, q) => q)
  assert.equal(w.clouds.flashes.length, 0)
  assert.ok(w.clouds.charge.every(q => q === 0))
})

test('reserves permit brief habitat loss, followed by extinction without reseeding', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  w.clouds.cloud.fill(0)
  w.clouds.dust.fill(0)
  w.laws.lifeGrowth = 0
  const initial = population(c)
  for (let t = 1; t <= 3; t++) {
    w.tick = t
    prepareLife(w)
    finishLife(w)
  }
  assert.equal(population(c), initial)
  for (let t = 4; t < 150; t++) {
    w.tick = t
    prepareLife(w)
    finishLife(w)
  }
  assert.equal(w.life.colonies.length, 0)
  assert.ok(w.life.starved > 0)
  w.clouds.cloud.fill(0.001)
  finishLife(w)
  assert.equal(w.life.colonies.length, 0)
})

test('overdensity kills fed creatures while adult traits remain fixed', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  c.positive = 1000
  c.negative = 1000
  c.energy = reserve(w, c)
  // Nearby colonies prevent isolated dispersal; mortality still regulates clusters.
  w.life.colonies.push({ ...structuredClone(c), id: 999, phase: c.phase + Math.PI })
  const traits = structuredClone(c.traits)
  w.tick = 1
  prepareLife(w)
  finishLife(w)
  assert.ok(w.life.crowded > 0)
  assert.equal(w.life.starved, 0)
  assert.deepEqual(c.traits, traits)
})

test('parents fund descendants and mutation happens only at birth', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  w.laws.lifeGrowth = 0
  c.positive = 40
  c.negative = 40
  c.energy = reserve(w, c)
  const traits = structuredClone(c.traits)
  const before = c.energy, count = population(c)
  w.tick = Math.ceil(w.laws.lifeGenerationDays * w.laws.rotationPeriod)
  finishLife(w)
  assert.equal(w.life.colonies.length, 2)
  const child = w.life.colonies[1]
  assert.deepEqual(child.parents, [c.id])
  assert.equal(child.generation, 1)
  assert.equal(population(c) + population(child), count)
  assert.ok(Math.abs(c.energy + child.energy - before) < 1e-12)
  assert.deepEqual(c.traits, traits)
  for (const [key, value] of Object.entries(child.traits)) {
    const limit = key === 'positiveRate' ? w.laws.lifeMutation : traits[key] * w.laws.lifeMutation
    assert.ok(Math.abs(value - traits[key]) <= limit + 1e-12)
  }
  w.laws.lifeMutation = 0
  assert.deepEqual(childTraits(w, [c]), c.traits)
})

test('wind dominates steering and positions remain on sphere', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  w.air.windU.fill(0.01)
  const previous = [...c.position], cell = c.cell
  prepareLife(w)
  const eastward = c.position.reduce((sum, p, k) => sum + (p - previous[k]) * w.sphere.grid.east[cell * 3 + k], 0)
  assert.ok(eastward > 0)
  assert.ok(Math.abs(Math.hypot(...c.position) - 1) < 1e-12)
})

test('life and its RNG rewind exactly; fast jumps preserve full ecology', () => {
  const w = habitatWorld()
  resetHistory(w)
  for (let t = 0; t < 12; t++) stepWorld(w)
  const expected = structuredClone(w.life)
  restore(w, findFrame(w.history, 4))
  while (w.tick < 12) stepWorld(w, false)
  assert.deepEqual(w.life, expected)
  const exact = habitatWorld(), jump = habitatWorld()
  for (let t = 0; t < 12; t++) stepWorld(exact, false)
  const job = createFastForward(jump, 12)
  assert.equal(job.prepared, true)
  while (!advanceFastForward(jump, job, 6)) { /* yield */ }
  assert.deepEqual(jump.life, exact.life)
  assert.deepEqual(jump.clouds, exact.clouds)
})

test('spontaneous birth requires real current lightning and is suppressed by total population', () => {
  const w = createWorld()
  w.life.seeded = true
  w.clouds.flashEvents.push({ cell: 10, tick: w.tick })
  assert.equal(lightningBirthChance(w), 0, 'historical visuals cannot create life')
  seedFromLightning(w)
  assert.equal(w.life.colonies.length, 0)
  w.clouds.charge[10] = 2 * w.laws.breakdownField
  stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 0, w.tick)
  assert.ok(w.clouds.flashes.includes(10))
  const empty = lightningBirthChance(w)
  assert.ok(empty > 0 && empty <= 0.00005)
  const template = habitatWorld().life.colonies[0]
  w.life.colonies = [{ ...template, positive: 10, negative: 10 }]
  const small = lightningBirthChance(w)
  w.life.colonies[0].positive = 1000
  assert.ok(lightningBirthChance(w) < small && small < empty)
  w.life.colonies = []
  w.clouds.flashes = Array.from({ length: 10000 }, (_, i) => i)
  assert.ok(lightningBirthChance(w) <= w.laws.lifeSpontaneousCap)
  w.laws.lifeSpontaneousChance = 0
  assert.equal(lightningBirthChance(w), 0)
})

test('lightning creates only tiny, widely varied colonies and debits remaining weather charge', () => {
  const w = createWorld()
  w.laws.lifeSpontaneousChance = 1 // Force the event; production laws remain rare.
  w.laws.lifeSpontaneousCap = 1
  w.clouds.charge[10] = 2
  stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 0, w.tick)
  const available = w.clouds.charge[10]
  const traits = []
  let poor = false, bothSigns = 0
  for (let seed = 0; seed < 100; seed++) {
    w.life = createLife(seed)
    w.life.seeded = true
    w.clouds.charge[10] = available
    seedFromLightning(w)
    assert.equal(w.life.colonies.length, 1)
    const c = w.life.colonies[0]
    assert.equal(c.origin, 'lightning')
    assert.equal(c.cell, 10)
    assert.ok(population(c) >= 1 && population(c) <= 3)
    assert.ok(c.energy <= reserve(w, c) * 0.25)
    assert.ok(Math.abs(w.clouds.charge[10] + c.energy - available) < 1e-7)
    traits.push(c.traits.efficiency)
    poor ||= c.traits.efficiency < 0.2 && c.traits.metabolism > 2
    bothSigns |= c.positive ? 1 : 0
    bothSigns |= c.negative ? 2 : 0
    seedFromLightning(w)
    assert.equal(w.life.lightningBirths, 1, 'at most one attempt per tick')
  }
  assert.ok(Math.max(...traits) - Math.min(...traits) > 1.5)
  assert.ok(poor, 'unfit traits are not filtered out')
  assert.equal(bothSigns, 3)
  // Poor newborns have no privileged protection after their birth tick.
  const c = w.life.colonies[0]
  c.energy = 0
  c.positive = 1
  c.negative = 0
  w.clouds.flashes = []
  w.tick++
  finishLife(w)
  assert.equal(w.life.colonies.length, 0)
})

test('loss of one creature does not deterministically leave the negative survivor', () => {
  const w = habitatWorld(), template = structuredClone(w.life.colonies[0])
  w.clouds.cloud.fill(0)
  w.clouds.dust.fill(0)
  w.tick = 1
  let positives = 0
  for (let seed = 0; seed < 400; seed++) {
    w.life = createLife(seed)
    w.life.seeded = true
    w.life.colonies = [{ ...structuredClone(template), positive: 1, negative: 1, energy: 0 }]
    finishLife(w)
    assert.equal(population(w.life.colonies[0]), 1)
    positives += w.life.colonies[0].positive
  }
  assert.ok(positives > 140 && positives < 260, `positive survivors: ${positives}/400`)
})

test('automatic founders wait for density; manual batches force birth and restart without resetting weather', () => {
  const w = createWorld()
  w.tick = 200
  w.clouds.dust.fill(w.laws.lifeDustScale * w.laws.lifeSeedDensity * 0.5)
  assert.equal(seedColonies(w), 0, 'warmup alone is insufficient')
  assert.equal(w.life.seeded, false)
  w.clouds.dust.fill(w.laws.lifeDustScale * w.laws.lifeSeedDensity * 2)
  assert.equal(seedColonies(w), 0, 'dense but uncharged habitat cannot feed founders')
  w.clouds.charge.fill(1)
  assert.equal(seedColonies(w), w.laws.lifeFounders)
  const fresh = createWorld()
  const weather = structuredClone(fresh.clouds)
  assert.equal(seedColonies(fresh, 7), 7, 'manual seeding works even at day zero')
  assert.equal(fresh.tick, 0)
  assert.equal(fresh.life.seeded, true)
  assert.deepEqual(fresh.clouds, weather)
  assert.equal(seedColonies(fresh), 0, 'forced initial batch suppresses duplicate automatic founders')
  const oldIds = fresh.life.colonies.map(c => c.id)
  fresh.life.colonies = []
  assert.equal(seedColonies(fresh, 4), 4, 'manual revival works after extinction')
  assert.ok(fresh.life.colonies.every(c => c.id > Math.max(...oldIds)))
  assert.equal(fresh.life.artificialColonies, 11)
  fresh.laws.lifeMaxColonies = 6
  assert.equal(seedColonies(fresh, 20), 2, 'addition respects the total colony ceiling')
  assert.equal(seedColonies(fresh, 1), 0)
  assert.equal(seedColonies(fresh, NaN), 0)
  assert.equal(seedColonies(fresh, -1), 0)
})

test('reproduction waits full planet days and birth variation can worsen efficiency', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  w.laws.lifeGrowth = 0
  c.positive = 40
  c.negative = 40
  c.energy = reserve(w, c)
  const traits = structuredClone(c.traits)
  const maturity = Math.ceil(w.laws.lifeGenerationDays * w.laws.rotationPeriod)
  w.tick = maturity - 1
  finishLife(w)
  assert.equal(w.life.births, 0)
  w.tick++
  finishLife(w)
  assert.equal(w.life.births, 1)
  let better = 0, worse = 0
  for (let i = 0; i < 400; i++) {
    const child = childTraits(w, [c])
    const change = child.efficiency / traits.efficiency - 1
    assert.ok(Math.abs(change) <= 0.015 + 1e-12)
    better += change > 0
    worse += change < 0
  }
  assert.ok(better > 140 && worse > 140)
  assert.deepEqual(c.traits, traits)
})

test('automatic batch waits for enough separated sites without consuming its RNG', () => {
  const w = createWorld()
  w.laws.lifeSeedDelay = 0
  w.laws.lifeSeparation = Math.PI
  w.clouds.cloud.fill(0.001)
  w.clouds.charge.fill(1)
  const before = structuredClone(w.life)
  assert.equal(seedColonies(w), 0)
  assert.deepEqual(w.life, before)
  w.laws.lifeSeparation = 0.18
  assert.equal(seedColonies(w), w.laws.lifeFounders)
})

test('an isolated crowded colony collects then launches living creatures without genetic evolution', () => {
  const w = habitatWorld(), parent = w.life.colonies[0]
  w.life.colonies = [parent]
  w.laws.lifeGrowth = 0
  parent.positive = 160
  parent.negative = 140
  parent.energy = reserve(w, parent)
  const before = structuredClone(parent)
  for (let t = 1; t <= w.laws.lifeGatherTicks; t++) {
    w.tick = t
    finishLife(w)
    assert.equal(w.life.colonies.length, 1)
    assert.equal(w.life.crowded, 0)
  }
  assert.ok(parent.crowdedGathering > 0)
  w.tick++
  finishLife(w)
  const child = w.life.colonies[1]
  assert.equal(w.life.dispersals, 1)
  assert.equal(child.origin, 'dispersal')
  assert.equal(child.generation, parent.generation)
  assert.deepEqual(child.traits, parent.traits)
  assert.equal(w.life.births, 0)
  assert.equal(parent.positive + child.positive, before.positive)
  assert.equal(parent.negative + child.negative, before.negative)
  const transferred = before.energy * population(child) / population(before)
  assert.ok(Math.abs(parent.energy + child.energy - (before.energy - transferred * w.laws.lifeLaunchCost)) < 1e-12)
  resetHistory(w)
  const state = structuredClone(w.life)
  const initial = [...child.position]
  for (let t = 0; t < w.laws.lifeLaunchTicks; t++) prepareLife(w)
  assert.equal(child.impulse, undefined)
  assert.ok(Math.hypot(...child.position.map((v, k) => v - initial[k])) > 0.1)
  assert.ok(Math.abs(Math.hypot(...child.position) - 1) < 1e-12)
  restore(w, findFrame(w.history, w.tick))
  assert.deepEqual(w.life, state, 'rewind preserves collection and active impulse')
})

test('nearby colonies and the colony ceiling block dispersal; collection cancels', () => {
  const w = habitatWorld(), c = w.life.colonies[0]
  w.life.colonies = [c]
  w.laws.lifeGrowth = 0
  c.positive = 160
  c.negative = 140
  c.energy = reserve(w, c)
  w.tick = 1
  finishLife(w)
  assert.ok(c.crowdedGathering > 0)
  w.life.colonies.push({ ...structuredClone(c), id: 999, phase: c.phase + Math.PI })
  w.tick++
  finishLife(w)
  assert.equal(c.crowdedGathering, 0)
  assert.equal(c.gatheringSince, undefined)
  assert.ok(w.life.crowded > 0)
  assert.equal(w.life.dispersals, 0)
  w.life.colonies = [c]
  w.laws.lifeMaxColonies = 1
  finishLife(w)
  assert.equal(c.crowdedGathering, 0)
  assert.equal(w.life.dispersals, 0)
})
