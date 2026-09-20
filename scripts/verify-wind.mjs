import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Uses the development-only scene handle to inspect geometry and inject a solver
// stop. Run against `pnpm dev`, not the production preview.
await mkdir('.shots', { recursive: true })
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(process.argv[2] || 'http://localhost:3123/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__sim?.scene)
  await page.getByTestId('global-readouts').waitFor()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.waitForFunction(() => window.__sim.world.value.tick >= 10)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Readouts', exact: true }).click()
  const tick = await page.evaluate(() => window.__sim.world.value.tick)
  const box = await page.locator('canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (const [name, delta] of [['out', 1000], ['in', -1600], ['back', 600]]) {
    const before = await page.evaluate(() => window.__sim.scene.camera.position.length())
    await page.mouse.wheel(0, delta)
    await page.waitForFunction(previous => Math.abs(window.__sim.scene.camera.position.length() - previous) > 0.01, before)
    await page.waitForTimeout(700)
    const state = await page.evaluate(() => {
      const { scene, world } = window.__sim
      const layer = scene.wind
      return {
        tick: world.value.tick,
        segments: layer.geo.instanceCount,
        visible: layer.obj.visible,
        finite: Array.from(layer.pos.slice(0, layer.count * 6)).every(Number.isFinite)
      }
    })
    assert.equal(state.tick, tick)
    assert.ok(state.visible && state.segments > 0 && state.finite, JSON.stringify(state))
    await page.screenshot({ path: `.shots/paused-wind-${name}.png` })
  }
  // A solver stop must be recoverable through the restored action, not just
  // remove a banner while leaving World.paused latched.
  await page.evaluate(() => {
    const world = window.__sim.world.value
    world.air.unstable = 'pressureCoupling'
    world.paused = true
  })
  await page.getByRole('button', { name: 'Dismiss and resume', exact: true }).click()
  await page.waitForFunction(previous => window.__sim.world.value.tick > previous, tick)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Go to day', exact: true }).fill('0')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await page.waitForFunction(() => window.__sim.world.value.tick === 0)
  await page.getByRole('button', { name: '◀ 1x', exact: true }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('button', { name: 'Resume forward', exact: true }).click()
  await page.waitForFunction(() => window.__sim.world.value.tick > 0)
  assert.equal(await page.getByRole('button', { name: '1x', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.deepEqual(errors, [])
  console.log('Verified paused wheel zoom, restored readouts, solver recovery and rewind recovery.')
} finally {
  await browser.close()
}
