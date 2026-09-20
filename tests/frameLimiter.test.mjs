import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

// Same extensionless-TS loader as the simulation tests: the frame governor is the
// one piece of the render side with scheduling maths worth pinning down, and it has
// no DOM dependency, so it can be driven by a synthetic vsync.
const require = createRequire(import.meta.url)
require.extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8')
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { FrameLimiter, capApplies, cappedRate } = require('../app/render/frameLimiter.ts')

/** Drive a limiter with a perfectly regular display at `refreshMs` per frame. */
function run(limiter, refreshMs, { from, to, start = 0, on } = {}) {
  const frames = []
  for (let t = start; t <= to; t += refreshMs) {
    if (t < from) continue
    const frame = limiter.read(t)
    if (on) on(t, frame)
    if (frame) frames.push({ t, ...frame })
  }
  return frames
}

function rateOf(frames, refreshMs) {
  const span = (frames.at(-1).t - frames[0].t + refreshMs) / 1000
  return frames.length / span
}

test('uncapped limiter renders every refresh', () => {
  const limiter = new FrameLimiter()
  const frames = run(limiter, 16.667, { to: 2000 })
  assert.ok(Math.abs(frames.length - 120) <= 2, `expected ~120 frames, got ${frames.length}`)
  assert.ok(Math.abs(rateOf(frames, 16.667) - 60) < 2)
  assert.ok(Math.abs(limiter.displayHz - 60) < 1, `display estimate ${limiter.displayHz}`)
})

test('a 30 fps ceiling on 60 Hz renders every other refresh and skips no time', () => {
  const limiter = new FrameLimiter()
  limiter.setMaxFps(30)
  // Warm the refresh estimate up first, as the real loop does.
  run(limiter, 16.667, { to: 500 })
  const frames = run(limiter, 16.667, { from: 500, to: 5500 })

  const rate = rateOf(frames, 16.667)
  assert.ok(rate > 28 && rate < 32, `expected ~30 fps, got ${rate.toFixed(2)}`)
  // Every accepted frame must cover the refreshes that were skipped, or capping
  // would slow the simulation down.
  const carried = frames.reduce((sum, f) => sum + f.dtMs, 0)
  const wall = frames.at(-1).t - (frames[0].t - frames[0].dtMs)
  assert.ok(Math.abs(carried - wall) < 1, `carried ${carried.toFixed(1)} ms of ${wall.toFixed(1)}`)
  for (const f of frames) assert.ok(f.dtMs > 25 && f.dtMs < 42, `frame dtMs ${f.dtMs}`)
})

test('a ceiling above the display costs nothing, including a 30 fps RDP session', () => {
  for (const refreshMs of [16.667, 31.25]) {
    const limiter = new FrameLimiter()
    limiter.setMaxFps(60)
    run(limiter, refreshMs, { to: 500 })
    const frames = run(limiter, refreshMs, { from: 500, to: 5000 })
    const rate = rateOf(frames, refreshMs)
    assert.ok(rate > 1000 / refreshMs - 3, `${refreshMs} ms refresh: ${rate.toFixed(1)} fps`)
    assert.equal(cappedRate(limiter.displayHz, 60), 0, `${refreshMs}: cap must be inert`)
  }
})

test('a ceiling below the display holds on a 120 Hz panel too', () => {
  const limiter = new FrameLimiter()
  limiter.setMaxFps(60)
  run(limiter, 8.333, { to: 500 })
  const frames = run(limiter, 8.333, { from: 500, to: 5500 })
  const rate = rateOf(frames, 8.333)
  assert.ok(rate > 56 && rate < 62, `120 Hz with a 60 ceiling gave ${rate.toFixed(1)} fps`)
})

test('a ceiling between two refreshes averages near the request instead of halving', () => {
  const limiter = new FrameLimiter()
  limiter.setMaxFps(60)
  run(limiter, 6.944, { to: 500 }) // 144 Hz
  const frames = run(limiter, 6.944, { from: 500, to: 5500 })
  const rate = rateOf(frames, 6.944)
  assert.ok(rate > 52 && rate < 62, `144 Hz with a 60 ceiling gave ${rate.toFixed(1)} fps`)
})

test('a ceiling is never exceeded by more than the display can distinguish', () => {
  const limiter = new FrameLimiter()
  limiter.setMaxFps(45)
  run(limiter, 16.667, { to: 500 })
  const frames = run(limiter, 16.667, { from: 500, to: 6500 })
  const rate = rateOf(frames, 16.667)
  assert.ok(rate <= 46, `45 fps ceiling measured ${rate.toFixed(1)} fps`)
  assert.ok(rate >= 28, `45 fps ceiling measured ${rate.toFixed(1)} fps`)
})

test('lowering the ceiling takes effect on the next refresh', () => {
  const limiter = new FrameLimiter()
  run(limiter, 16.667, { to: 1000 })
  limiter.setMaxFps(30)
  let firstAfter = null
  const frames = run(limiter, 16.667, {
    from: 1016.667,
    to: 2700,
    on: (t, f) => {
      if (firstAfter === null && f) firstAfter = t
    }
  })
  assert.ok(firstAfter !== null && firstAfter < 1050, `first frame after the change at ${firstAfter}`)
  assert.ok(frames.length < 60, `expected the rest to be throttled, got ${frames.length}`)
})

test('a backgrounded tab resumes with one normal frame instead of a catch-up jump', () => {
  const limiter = new FrameLimiter()
  run(limiter, 16.667, { to: 1000 })
  let frame = limiter.read(7000)
  assert.ok(frame, 'the resumed frame must be accepted')
  assert.ok(frame.dtMs < 50, `resumed dtMs was ${frame.dtMs}`)
  frame = limiter.read(7016.667)
  assert.ok(frame && Math.abs(frame.dtMs - 16.667) < 0.01, `next dtMs was ${frame?.dtMs}`)
})

test('dropped frames do not inflate the refresh estimate', () => {
  const limiter = new FrameLimiter()
  // A 60 Hz display where every third callback lands two refreshes late.
  let i = 0
  limiter.read(0)
  for (let t = 16.667; t <= 3000; t += (i++ % 3 === 0 ? 33.334 : 16.667)) {
    limiter.read(t)
  }
  assert.ok(Math.abs(limiter.displayHz - 60) < 2, `estimated ${limiter.displayHz.toFixed(1)} Hz`)
})

test('cap helpers', () => {
  assert.equal(capApplies(60, 0), false, 'zero is uncapped')
  assert.equal(capApplies(0, 30), true, 'an unknown display must not disable the cap')
  assert.equal(capApplies(31.25, 60), false, 'a 30 fps RDP session is already slower')
  assert.equal(capApplies(60, 30), true)
  assert.equal(cappedRate(60, 0), 0)
  assert.equal(cappedRate(31.25, 60), 0)
  assert.ok(Math.abs(cappedRate(60, 30) - 30) < 1)
  assert.ok(Math.abs(cappedRate(0, 30) - 30) < 1, 'unknown display reports the request')
})

test('a nonsensical ceiling is ignored rather than fatal', () => {
  for (const bad of [NaN, -5, Infinity, undefined, null]) {
    const limiter = new FrameLimiter()
    limiter.setMaxFps(bad)
    const frames = run(limiter, 16.667, { to: 500 })
    assert.equal(limiter.maxFps, 0, `${String(bad)} should read as uncapped`)
    assert.ok(frames.length > 25)
  }
})

test('the target the UI promises matches what the limiter does', () => {
  const limiter = new FrameLimiter()
  assert.equal(limiter.targetFps, 0, 'uncapped')
  limiter.setMaxFps(30)
  run(limiter, 16.667, { to: 500 })
  assert.ok(Math.abs(limiter.targetFps - 30) < 1, `target ${limiter.targetFps}`)
  limiter.setMaxFps(240)
  assert.equal(limiter.targetFps, 0, 'a ceiling over the display promises nothing')
})
