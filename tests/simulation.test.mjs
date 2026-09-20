import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

// Load the existing extensionless TS simulation modules without a browser or
// adding a test framework dependency. This hook is confined to this test process.
const require = createRequire(import.meta.url)
require.extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8')
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { createWorld, stepWorld, stepGlobals, seek, resetHistory } = require('../app/sim/world.ts')
const { defaultLaws } = require('../app/sim/laws.ts')
const { orbitalPeriod } = require('../app/sim/units.ts')
const { clockOf } = require('../app/sim/units.ts')
const { stepAir } = require('../app/sim/air.ts')
const { stepClouds } = require('../app/sim/clouds.ts')
const { transportTracers } = require('../app/sim/tracerTransport.ts')
const { CloudLayer } = require('../app/render/cloudLayer.ts')
const { WindLayer } = require('../app/render/windLayer.ts')
const THREE = require('three')
const { equilibriumStrain, strainOffsetKm, figureOffsetKm, relaxStrain, computeFigure } = require('../app/sim/shape.ts')
const { record, restore, findFrame } = require('../app/sim/history.ts')
const { createFastForward, advanceFastForward, interruptFastForward } = require('../app/sim/fastForward.ts')

test('tensor matches additive radial deformation for inclined and multiple moons', () => {
  const laws = defaultLaws()
  const fig = computeFigure([
    { name: 'a', mass: 0.08, pos: [2, 3, 1] },
    { name: 'b', mass: 0.02, pos: [-3, 2, 4] }
  ], laws, 0)
  const strain = equilibriumStrain(fig)
  for (const v of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 2, 3]]) {
    const n = v.map(x => x / Math.hypot(...v))
    assert.ok(Math.abs(strainOffsetKm(strain, ...n) - figureOffsetKm(fig, ...n)) < 1e-10)
  }
  const rigidTide = equilibriumStrain({ ...fig, tides: [] })
  assert.deepEqual(Array.from(rigidTide), [0, -fig.flattening, 0, 0, 0, 0])
})

test('rock relaxation uses simulation time and suppresses daily breathing', () => {
  const laws = defaultLaws()
  const tau = laws.shapeRelaxationDays * laws.rotationPeriod
  const target = new Float64Array([0, -0.02, 0, 0, 0, 0])
  const one = new Float64Array(6), many = new Float64Array(6)
  relaxStrain(one, target, laws, tau)
  for (let i = 0; i < 100; i++) relaxStrain(many, target, laws, tau / 100)
  assert.ok(Math.abs(one[1] - -0.02 * (1 - Math.exp(-1))) < 1e-12)
  assert.ok(Math.abs(one[1] - many[1]) < 1e-12)
  let lo = Infinity, hi = -Infinity
  const s = new Float64Array(6)
  for (let i = 0; i < 15000; i++) {
    target[0] = 0.003 * Math.cos(i * Math.PI * 2 / laws.rotationPeriod)
    relaxStrain(s, target, laws, 1)
    if (i > 14000) {
      lo = Math.min(lo, s[0])
      hi = Math.max(hi, s[0])
    }
  }
  assert.ok(hi - lo < 0.00004, `daily strain swing ${hi - lo}`)
})

test('substepped circular orbit remains near the tidal lock', () => {
  const laws = defaultLaws()
  laws.rotationPeriod = orbitalPeriod(4, laws)
  const w = createWorld(20260919, laws)
  w.bodies.splice(1)
  for (let i = 0; i < 1200; i++) stepGlobals(w)
  const dir = w.figure.peakTideDir
  assert.ok(Math.abs(Math.atan2(dir[2], dir[0])) < 0.02)
  assert.ok(Math.abs(Math.hypot(...w.bodies[0].pos) - 4) < 0.001)
})

test('rewind restores clouds, strain and escaped bodies, then replays identically', () => {
  const w = createWorld()
  for (let i = 0; i < 24; i++) stepWorld(w)
  const expected = structuredClone({ air: w.air, clouds: w.clouds, strain: w.strain })
  const snap = findFrame(w.history, 16)
  w.bodies.pop()
  w.escaped.push('lost')
  restore(w, snap)
  assert.equal(w.bodies.length, 2)
  assert.deepEqual(w.escaped, [])
  while (w.tick < 24) stepWorld(w, false)
  assert.deepEqual({ air: w.air, clouds: w.clouds, strain: w.strain }, expected)
})

test('fast jump preserves global evolution, lands exactly and creates complete history', () => {
  const exact = createWorld(), fast = createWorld()
  fast.laws.lifeEnabled = 0
  const target = 5000
  for (let i = 0; i < target; i++) stepGlobals(exact)
  const job = createFastForward(fast, target)
  while (!advanceFastForward(fast, job, 6)) { /* bounded batches */ }
  assert.equal(fast.tick, target)
  assert.deepEqual(fast.strain, exact.strain)
  assert.deepEqual(fast.bodies, exact.bodies)
  assert.equal(fast.history.frames.length, 1)
  assert.equal(fast.history.frames[0].tick, target)
  assert.ok(fast.air.temp.every(Number.isFinite))
  assert.ok(fast.clouds.vapor.every(Number.isFinite))
  assert.ok(fast.air.windU.some(x => x !== 0))
})

test('seek yields between ticks, includes initial state, and rejects invalid dates', () => {
  const w = createWorld()
  assert.equal(findFrame(w.history, 0).tick, 0)
  assert.equal(seek(w, 1000, 0).done, false)
  assert.equal(w.tick, 1)
  assert.equal(seek(w, NaN).reachable, false)
  assert.equal(seek(w, 0).done, true)
  assert.equal(w.tick, 0)
  const job = createFastForward(w, 100000)
  assert.equal(advanceFastForward(w, job, 0), false)
  assert.equal(w.tick, 1)
  interruptFastForward(w, job)
  assert.equal(w.history.frames[0].tick, 1)
  resetHistory(w)
  record(w.history, w, true)
  assert.equal(w.history.frames.length, 1)
  assert.throws(() => createFastForward(w, Infinity), RangeError)
})

test('day boundaries and convergent pressure respond correctly', () => {
  const w = createWorld()
  assert.equal(clockOf(Math.ceil(1000 * w.laws.rotationPeriod), w.laws).day, 1000)
  const g = w.sphere.grid
  for (let i = 0; i < g.count; i++) w.air.windV[i] = -0.005 * Math.sin(g.lat[i])
  stepAir(g, w.terrain, w.caves, w.air, w.laws, 0, 1)
  let sum = 0, n = 0
  for (let i = 0; i < g.count; i++) {
    if (Math.abs(g.lat[i]) < 0.2) {
      sum += w.air.pressureAnomaly[i]
      n++
    }
  }
  assert.ok(sum / n > 0, 'converging equatorial air must raise pressure')
  for (let i = 0; i < 1000; i++) stepWorld(w, false)
  assert.equal(w.air.unstable, null)
  assert.ok(w.air.windU.every(Number.isFinite))
  assert.ok(w.air.pressureAnomaly.every(Number.isFinite))
  assert.ok(w.clouds.cloud.every(Number.isFinite))
  assert.ok(w.air.maxSpeed < 0.5, `unexpected wind instability: ${w.air.maxSpeed}`)
})

test('cold mountain air condenses while warm low ground stays clear', () => {
  const w = createWorld()
  w.air.temp.fill(290)
  w.air.press.fill(1000)
  w.terrain.elevSim.fill(0)
  w.terrain.elevSim[0] = 30
  w.clouds.frost.fill(0)
  w.clouds.vapor.fill(0.002)
  stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 1)
  assert.ok(w.clouds.cloud[0] > 0)
  assert.equal(w.clouds.cloud[1], 0)
})

test('cloud opacity is local and a paused cloud layer is unchanged', () => {
  const w = createWorld()
  const layer = new CloudLayer(new THREE.Group(), w, 1.1)
  w.clouds.cloud[0] = 0.0001
  w.clouds.dust[0] = 1
  layer.update(0, [1, 0, 0])
  const local = layer.smCloud[0]
  w.clouds.cloud[1] = 100
  w.clouds.maxCloud = 100
  w.tick++
  layer.update(0, [1, 0, 0])
  assert.equal(layer.smCloud[0], local)
  const evolve = () => layer.mat.uniforms.uEvolve.value.clone()
  const before = { time: layer.time, cloud: layer.smCloud.slice(), dust: layer.smDust.slice(), evolve: evolve(), flash: layer.flash }
  for (let i = 0; i < 10; i++) layer.update(0, [1, 0, 0])
  assert.deepEqual({ time: layer.time, cloud: layer.smCloud, dust: layer.smDust, evolve: evolve(), flash: layer.flash }, before)
  // The detail volume drifts with simulation time, so the pattern billows...
  w.tick++
  layer.update(1, [1, 0, 0])
  assert.ok(evolve().distanceTo(before.evolve) > 0, 'detail must evolve with simulation time')
  // ...but on a closed loop, so however long the app runs it never reaches
  // coordinates float32 value noise cannot resolve, and never needs a reset.
  w.tick += 100000
  layer.update(1, [1, 0, 0])
  assert.ok(evolve().length() < 10, `detail coordinates grew to ${evolve().length()}`)
  assert.equal(layer.time, w.tick, 'detail must follow simulation time')
  layer.dispose()
})

test('transport conserves a moving plume and remains positive at large Courant numbers', () => {
  const w = createWorld(), g = w.sphere.grid
  const plume = new Float32Array(g.count)
  for (let i = 0; i < g.count; i++) {
    w.air.windU[i] = 0.01 * Math.cos(g.lat[i])
    plume[i] = Math.exp((g.pos[i * 3] - 1) / 0.008)
  }
  const mass = () => plume.reduce((sum, x) => sum + x, 0)
  const start = mass()
  for (let i = 0; i < 40; i++) transportTracers(g, w.air, [plume], 1)
  const x = plume.reduce((sum, v, i) => sum + v * g.pos[i * 3], 0)
  const z = plume.reduce((sum, v, i) => sum + v * g.pos[i * 3 + 2], 0)
  assert.ok(Math.abs(Math.abs(Math.atan2(z, x)) - 0.4) < 0.09, 'plume centroid should travel with zonal wind')
  transportTracers(g, w.air, [plume], 100)
  assert.ok(plume.every(x => x >= 0 && Number.isFinite(x)))
  assert.ok(Math.abs(mass() / start - 1) < 1e-5)
})

test('dust sources exhaust, travel, settle and conserve the surface plus airborne inventory', () => {
  const w = createWorld(), g = w.sphere.grid, c = w.clouds
  w.laws.dustThreshold = 0
  w.laws.dustLifting = 50
  c.surfaceDust.fill(0)
  c.surfaceDust[100] = 3
  w.air.windU.fill(0.02)
  w.air.press.fill(1000)
  const sum = field => field.reduce((s, x) => s + x, 0)
  for (let t = 0; t < 40; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.ok(c.surfaceDust[100] < 0.1, 'source must deplete instead of creating an infinite stationary plume')
  assert.ok(c.dust.some((v, i) => i !== 100 && v > 0.01))
  assert.ok(Math.abs(sum(c.surfaceDust) + sum(c.dust) + sum(c.dustAloft) - 3) < 1e-4)
  const airborne = sum(c.dust)
  w.laws.dustLifting = 0
  for (let t = 0; t < 300; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.ok(sum(c.dust) < airborne * 0.45, 'cloud must dissipate when lifting stops')
  assert.ok(Math.abs(sum(c.surfaceDust) + sum(c.dust) + sum(c.dustAloft) - 3) < 1e-4)
})

test('cloud and dust mass is transported away from its source', () => {
  const w = createWorld()
  w.laws.vapourSupply = 0
  w.laws.dustLifting = 0
  w.laws.dustSettling = 0
  w.laws.cloudDecay = 0
  w.laws.condensation = 0
  w.laws.cloudFallout = 0
  w.air.windU.fill(0.01)
  w.air.press.fill(1000)
  w.clouds.cloud[100] = 0.001
  w.clouds.dust[100] = 1
  for (let i = 0; i < 10; i++) stepClouds(w.sphere.grid, w.terrain, w.air, w.clouds, w.laws, 1, i)
  assert.ok(w.clouds.cloud[100] < 0.001)
  assert.ok(w.clouds.dust[100] < 1)
  assert.ok(w.clouds.cloud.some((value, i) => i !== 100 && value > 0))
  assert.ok(w.clouds.dust.some((value, i) => i !== 100 && value > 0))
})

test('wind LOD reduces actual geometry and stays above detailed terrain', () => {
  const w = createWorld()
  for (let i = 0; i < 60; i++) stepWorld(w, false)
  const layer = new WindLayer(new THREE.Group(), w)
  layer.setTerrain(5)
  layer.update(1000, false, 5.5)
  assert.equal(layer.activeStreams, 42)
  const farSegments = layer.geo.instanceCount
  layer.update(1000, false, 1.3)
  assert.equal(layer.activeStreams, 642)
  assert.ok(layer.geo.instanceCount > farSegments * 4)
  const fullSegments = layer.geo.instanceCount
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
  camera.position.set(0, 0, 1.3)
  camera.lookAt(0, 0, 0)
  layer.update(1000, false, 1.3, camera)
  assert.ok(layer.activeStreams > 0 && layer.activeStreams < 642 / 2)
  assert.ok(layer.geo.instanceCount < fullSegments / 2, 'offscreen paths must not be traced/uploaded')
  const { mesh } = w.sphere
  const p = new THREE.Vector3()
  for (let sample = 0; sample < 60; sample++) {
    const offset = Math.floor(sample * layer.geo.instanceCount / 60) * 6
    p.fromArray(layer.pos, offset)
    const radius = p.length()
    p.normalize()
    let best = -Infinity, nearest = 0
    for (let v = 0; v < mesh.count; v++) {
      const dot = p.x * mesh.pos[v * 3] + p.y * mesh.pos[v * 3 + 1] + p.z * mesh.pos[v * 3 + 2]
      if (dot > best) {
        best = dot
        nearest = v
      }
    }
    assert.ok(radius > 1 + w.terrain.elev[nearest] * 5 / 6000)
  }
  // Crossing a nearest-cell boundary must not make the interpolated flow jump.
  const g = w.sphere.grid, a = 100, b = g.nbrList[g.nbrStart[a]]
  const va = new THREE.Vector3().fromArray(g.pos, a * 3)
  const vb = new THREE.Vector3().fromArray(g.pos, b * 3)
  layer.sample(va.clone().lerp(vb, 0.499999).normalize(), a)
  const left = layer.flow.clone()
  layer.sample(va.clone().lerp(vb, 0.500001).normalize(), b)
  assert.ok(left.distanceTo(layer.flow) < 1e-6)
  layer.dispose()
})

test('pausing uses the current wind field through zoom changes after a calm frame', () => {
  const w = createWorld()
  const layer = new WindLayer(new THREE.Group(), w)
  layer.setTerrain(5)
  layer.update(1, false, 3)
  // One short render after calm: temporal smoothing has not caught up yet.
  w.air.windU.fill(0.00001)
  w.tick++
  layer.update(0.2, true, 3)
  for (const distance of [5.5, 1.3, 3]) {
    layer.update(1000, false, distance)
    assert.ok(layer.geo.instanceCount > 0, `Paused wind must render at distance ${distance}`)
  }
  assert.equal(w.tick, 1, 'Camera changes must not advance the simulation')
  layer.dispose()
})

test('pausing settles the wind field instead of snapping it', () => {
  const w = createWorld()
  const layer = new WindLayer(new THREE.Group(), w)
  layer.setTerrain(5)
  for (let t = 0; t < 60; t++) {
    stepWorld(w, false)
    layer.update(1, true, 3)
  }
  // Force a gap between the displayed field and the solver's, as playback speed does.
  w.air.windU.fill(0.05)
  w.air.windV.fill(-0.03)
  const before = Float32Array.from(layer.field)
  layer.update(1, false, 3)

  const g = w.sphere.grid
  const targetAt = j => g.east[j] * w.air.windU[(j / 3) | 0] + g.north[j] * w.air.windV[(j / 3) | 0]
  let moved = 0, gap = 0
  for (let j = 0; j < g.count * 3; j++) {
    moved = Math.max(moved, Math.abs(layer.field[j] - before[j]))
    gap = Math.max(gap, Math.abs(targetAt(j) - before[j]))
  }
  assert.ok(gap > 1e-3, 'the test must create a gap worth crossing')
  // The whole visible bug: one paused frame used to cross 100% of it at once and
  // re-threw every streamline.
  assert.ok(moved < gap * 0.3, `one paused frame crossed ${((moved / gap) * 100).toFixed(0)}% of the gap`)

  // It must still arrive, or a later zoom traces a stale near-calm field.
  layer.update(1000, false, 3)
  let residual = 0
  for (let j = 0; j < g.count * 3; j++) residual = Math.max(residual, Math.abs(layer.field[j] - targetAt(j)))
  assert.ok(residual < gap * 0.01, `settled field is still ${residual.toExponential(2)} from the solver's`)
  layer.dispose()
})

test('sub-threshold cells still lift, so calm ground is not a one-way dust trap', () => {
  const w = createWorld(), g = w.sphere.grid, c = w.clouds
  // Put every cell well under the saltation threshold, worst-case roughness included.
  let maxRough = 0
  for (const r of w.terrain.roughness) if (r > maxRough) maxRough = r
  const calm = (w.laws.dustThreshold / Math.sqrt(w.laws.dragCoefficient * (1 + maxRough))) * 0.5
  c.surfaceDust.fill(1)
  c.dust.fill(0)
  w.air.windU.fill(calm)
  w.air.windV.fill(0)
  w.air.press.fill(1000)
  const sum = f => f.reduce((s, x) => s + x, 0)

  // A hard cutoff emits nothing at all here, which is what made these cells sinks:
  // settling still ran in every one of them, so dust could only ever arrive.
  w.laws.dustGustiness = 0
  for (let t = 0; t < 40; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.equal(sum(c.dust), 0, 'a hard threshold must emit nothing below itself')

  // Gusts put the upper tail of the distribution over the threshold even though the
  // cell mean is under it, so the ground can give dust back.
  w.laws.dustGustiness = 0.4
  for (let t = 0; t < 40; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.ok(sum(c.dust) > 0, 'gusts must lift from sub-threshold cells')
  // The tail is a tail, not a new source. At half the threshold it raises about 1% of
  // the available dust over these 40 ticks, where a storm strips its cells almost bare.
  assert.ok(sum(c.dust) < g.count * 0.03, `sub-threshold lifting must stay weak, got ${sum(c.dust)}`)
  // ...and it is still only an exchange with the surface.
  assert.ok(Math.abs(sum(c.dust) + sum(c.surfaceDust) - g.count) < 1e-3, 'dust must stay conserved')
})

test('rising air lofts tracers, sinking air returns them, and the column is conserved', () => {
  const w = createWorld(), g = w.sphere.grid, c = w.clouds
  const sum = f => f.reduce((s, x) => s + x, 0)
  const column = () => sum(c.dust) + sum(c.dustAloft) + sum(c.surfaceDust)
  w.laws.dustLifting = 0 // isolate vertical transport from emission
  c.surfaceDust.fill(0)
  c.dust.fill(0)
  c.dustAloft.fill(0)
  c.dust[100] = 1
  w.air.press.fill(1000)

  // Rising everywhere: the surface layer must be able to vent upward. Without this
  // a convergence zone can only fill, which is what pinned everything at the equator.
  w.air.upper.exchange.fill(0.05)
  for (let t = 0; t < 10; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.ok(sum(c.dustAloft) > 0, 'rising air must carry dust into the upper layer')
  assert.ok(Math.abs(column() - 1) < 1e-4, `lofting must conserve the column, got ${column()}`)

  // Sinking brings it back, so the exchange is a circulation and not a one-way leak.
  const lofted = sum(c.dustAloft)
  w.air.upper.exchange.fill(-0.05)
  // 20 ticks at ~4.9% of the remaining load per tick leaves well under half.
  for (let t = 0; t < 20; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.ok(sum(c.dustAloft) < lofted * 0.5,
    `sinking air must entrain dust back down, ${(sum(c.dustAloft) / lofted * 100).toFixed(0)}% left aloft`)
  assert.ok(Math.abs(column() - 1) < 1e-4, `subsidence must conserve the column, got ${column()}`)

  // A sealed layer is still available, and is exactly the old behaviour.
  w.laws.tracerLofting = 0
  c.dust.fill(0)
  c.dustAloft.fill(0)
  c.surfaceDust.fill(0)
  c.dust[100] = 1
  w.air.upper.exchange.fill(0.05)
  for (let t = 0; t < 10; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)
  assert.equal(sum(c.dustAloft), 0, 'zero lofting must seal the surface layer')
})

test('precipitation is density-thresholded, so cloud size decides cloud lifetime', () => {
  const w = createWorld(), g = w.sphere.grid, c = w.clouds
  const qc = w.laws.cloudAutoconversion
  assert.ok(qc > 0, 'the default must have a threshold at all')
  // Two cells: one thin cloud below the threshold, one dense one well above it.
  c.cloud.fill(0)
  c.cloudAloft.fill(0)
  c.vapor.fill(0)
  c.frost.fill(0)
  c.cloud[100] = qc * 0.5
  c.cloud[200] = qc * 4
  w.air.press.fill(1000)
  // Isolate precipitation: evaporation would also thin both clouds and is a
  // separate mechanism with its own test above.
  w.laws.cloudDecay = 0
  const thin0 = c.cloud[100], dense0 = c.cloud[200]
  for (let t = 0; t < 30; t++) stepClouds(g, w.terrain, w.air, c, w.laws, 1, t)

  // The thin cloud cannot precipitate at all: its droplets never grow enough.
  assert.equal(c.frost[100], 0, 'a cloud below the threshold must not precipitate')
  assert.equal(c.cloud[100], thin0, 'and so it is still entirely there')
  // The dense one rains, and loses a larger FRACTION than the thin one - which is
  // exactly what a rate linear in cloud mass could never produce.
  assert.ok(c.frost[200] > 0, 'a cloud above the threshold must precipitate')
  const thinLost = 1 - c.cloud[100] / thin0
  const denseLost = 1 - c.cloud[200] / dense0
  assert.ok(denseLost > thinLost, `dense cloud must clear faster: ${denseLost.toFixed(3)} vs ${thinLost.toFixed(3)}`)
  // It must stop once it has rained back down to the threshold, not run to zero.
  assert.ok(c.cloud[200] >= qc * 0.9, `precipitation must stall at the threshold, left ${c.cloud[200]}`)
})
