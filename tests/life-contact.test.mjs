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
const { createWorld } = require('../app/sim/world.ts')
const { seedColonies, finishLife, population, reserve } = require('../app/sim/life.ts')
const { ColonyLayer } = require('../app/render/colonyLayer.ts')
const { LightningLayer } = require('../app/render/lightningLayer.ts')
const { stepClouds } = require('../app/sim/clouds.ts')
const THREE = require('three')

function pair() {
  const w = createWorld()
  w.laws.lifeSeedDelay = 0
  w.laws.lifeGrowth = 0
  w.clouds.cloud.fill(0.001)
  w.clouds.charge.fill(1)
  seedColonies(w)
  const a = w.life.colonies[0]
  a.positive = 40
  a.negative = 40
  a.energy = reserve(w, a)
  const b = { ...structuredClone(a), id: 500 }
  w.life.colonies = [a, b]
  w.tick = Math.ceil(w.laws.lifeGenerationDays * w.laws.rotationPeriod)
  return w
}

test('compatible parents fund one joint offspring, incompatible contacts dissipate equally', () => {
  const w = pair()
  const energy = w.life.colonies.reduce((s, c) => s + c.energy, 0)
  finishLife(w)
  assert.equal(w.life.colonies.length, 3)
  assert.deepEqual(w.life.colonies[2].parents, [1, 500])
  assert.equal(w.life.colonies.reduce((s, c) => s + population(c), 0), 160)
  assert.ok(Math.abs(w.life.colonies.reduce((s, c) => s + c.energy, 0) - energy) < 1e-12)
  const bad = pair()
  bad.laws.lifeGenerationDays = 100
  bad.life.colonies[1].phase += Math.PI
  const before = bad.life.colonies[0].energy
  finishLife(bad)
  assert.equal(bad.life.colonies.length, 2)
  assert.ok(bad.life.colonies[0].energy < before)
  assert.equal(bad.life.colonies[0].energy, bad.life.colonies[1].energy)
})

test('colony rendering and visibility do not advance or mutate life', () => {
  const w = pair(), state = structuredClone(w.life)
  const group = new THREE.Group(), layer = new ColonyLayer(group, w)
  layer.update(1.1, true, 1)
  const mesh = group.children[0], sparks = group.children[1]
  const positions = mesh.geometry.attributes.position.array.slice()
  layer.update(1.1, false, 1)
  assert.equal(mesh.visible, false)
  assert.equal(sparks.visible, true)
  layer.update(1.1, true, 1, false)
  assert.equal(mesh.visible, true)
  assert.equal(sparks.visible, false)
  assert.deepEqual(mesh.geometry.attributes.position.array, positions)
  assert.deepEqual(w.life, state)
  assert.equal(mesh.geometry.drawRange.count, 2 * 48 * 2)
  layer.dispose()
  assert.equal(group.children.length, 0)
})

test('sustained compatible contact merges and preserves populations, energy and weighted traits', () => {
  const w = pair()
  w.laws.lifeGenerationDays = 1000
  w.life.colonies[1].traits.efficiency = 1.3
  const before = structuredClone(w.life.colonies)
  const energy = before.reduce((sum, c) => sum + c.energy, 0)
  for (let i = 0; i < w.laws.lifeMergeTicks; i++) {
    w.tick++
    finishLife(w)
  }
  assert.equal(w.life.colonies.length, 1)
  const merged = w.life.colonies[0]
  assert.deepEqual(merged.mergedFrom, [1, 500])
  assert.equal(population(merged), 160)
  assert.equal(merged.positive, 80)
  assert.ok(Math.abs(merged.energy - energy) < 1e-12)
  assert.equal(merged.traits.efficiency, (before[0].traits.efficiency + 1.3) / 2)
  assert.equal(w.life.merges, 1)
  assert.equal(w.life.births, 0)
  assert.equal(w.life.deaths, 0)
  assert.deepEqual(w.life.contacts, {})
  const separated = pair()
  separated.laws.lifeGenerationDays = 1000
  finishLife(separated)
  assert.equal(Object.keys(separated.life.contacts).length, 1)
  separated.life.colonies[1].position = separated.life.colonies[0].position.map(v => -v)
  separated.tick++
  finishLife(separated)
  assert.deepEqual(separated.life.contacts, {})
  assert.equal(separated.life.merges, 0)
})

test('visible lightning comes only from actual weather discharges and expires in simulation time', () => {
  const w = createWorld(), parent = new THREE.Group()
  const layer = new LightningLayer(parent, w)
  layer.update(1.1)
  assert.equal(parent.children[0].geometry.drawRange.count, 0)
  w.clouds.charge[10] = w.laws.breakdownField * 2
  stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 1, w.tick)
  assert.ok(w.clouds.flashEvents.some(e => e.cell === 10))
  w.tick++
  const before = structuredClone(w.clouds)
  layer.update(1.1)
  assert.ok(parent.children[0].geometry.drawRange.count > 0)
  const positions = parent.children[0].geometry.attributes.position.array.slice()
  layer.update(1.1)
  assert.deepEqual(parent.children[0].geometry.attributes.position.array, positions)
  assert.deepEqual(w.clouds, before)
  w.tick += 7
  layer.update(1.1)
  assert.equal(parent.children[0].geometry.drawRange.count, 0)
  layer.dispose()
})
