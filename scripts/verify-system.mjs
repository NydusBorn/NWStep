import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

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
  await page.goto(process.argv[2] || 'http://localhost:3123/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__sim?.scene)
  async function set(name, value) {
    const input = page.getByRole('spinbutton', { name: `${name} value`, exact: true })
    await input.fill(String(value))
    await input.press('Tab')
  }
  await set('Planet radius', 8000)
  await page.waitForFunction(() => window.__sim.world.value.laws.planetRadiusKm === 8000)
  await set('Distance to star', 2)
  await page.waitForFunction(() => Math.abs(window.__sim.scene.starMesh.position.length() - 140) < 0.01)
  await set('Inner moon orbit radius', 8)
  await set('Outer moon orbit radius', 30)
  await set('Inner moon inclination', 90)
  await page.waitForFunction(() => window.__sim.world.value.laws.innerOrbitInclination === 90)
  const state = await page.evaluate(() => {
    const w = window.__sim.world.value
    return { radius: w.figure.equatorialKm, orbits: w.bodies.map(b => Math.hypot(...b.pos)), velocity: w.bodies[0].vel, tick: w.tick }
  })
  assert.equal(state.radius, 8000)
  assert.deepEqual(state.orbits, [8, 30])
  assert.ok(state.velocity[1] > 0 && Math.abs(state.velocity[2]) < 1e-10)
  assert.equal(state.tick, 0, 'Editing the system must not advance paused time')
  await page.getByRole('button', { name: /^System/ }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.shots/system-settings.png' })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Settings', exact: true }).click()
  const file = await (await downloadPromise).path()
  const settings = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(settings.laws.planetRadiusKm, 8000)
  assert.equal(settings.laws.starDistance, 2)
  assert.equal(settings.laws.innerOrbitRadius, 8)
  await page.getByRole('button', { name: 'Reset laws', exact: true }).click()
  await page.waitForFunction(() => window.__sim.world.value.laws.planetRadiusKm === 6000)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import Settings', exact: true }).click()
  await (await chooserPromise).setFiles(file)
  await page.waitForFunction(() => window.__sim.world.value.laws.planetRadiusKm === 8000)
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__sim?.world.value.laws.innerOrbitRadius === 8)
  assert.equal(await page.evaluate(() => window.__sim.world.value.laws.starDistance), 2)
  await set('Planet radius', 0)
  await page.waitForFunction(() => window.__sim.world.value.laws.planetRadiusKm === 2000)
  assert.equal(await page.getByRole('spinbutton', { name: 'Planet radius value', exact: true }).inputValue(), '2000')
  assert.deepEqual(errors, [])
  console.log('Verified radius, stellar distance, moon orbits/tilt, reset, export/import, persistence and bounds.')
} finally {
  await browser.close()
}
