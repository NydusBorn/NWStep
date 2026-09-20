import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:3123/'
await mkdir('.shots', { recursive: true })
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
  await page.locator('canvas').waitFor()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '.shots/a1.png' })
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: '4x', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '4x', exact: true }).getAttribute('aria-pressed'), 'true')
  const slider = page.getByRole('slider').first()
  const before = await slider.getAttribute('aria-valuenow')
  await slider.focus()
  await slider.press('ArrowRight')
  assert.notEqual(await slider.getAttribute('aria-valuenow'), before)
  await page.getByRole('button', { name: 'Temperature', exact: true }).click()
  await page.screenshot({ path: '.shots/a2.png' })
  await page.getByRole('button', { name: 'Terrain', exact: true }).click()
  await page.getByRole('button', { name: 'Readouts', exact: true }).click()
  await page.mouse.move(650, 420)
  await page.mouse.down()
  await page.mouse.move(450, 380, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.shots/a3.png' })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Timestep', exact: true }).click()
  const download = await downloadPromise
  const path = await download.path()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import Timestep', exact: true }).click()
  await (await chooserPromise).setFiles(path)
  await page.getByText('Replaying to the saved timestep under its exported laws.').waitFor()
  await page.getByRole('button', { name: 'Toggle laws', exact: true }).click()
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must not overflow horizontally')
  await page.screenshot({ path: '.shots/mobile.png' })
  await page.getByRole('button', { name: 'Toggle laws', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(700)
  await page.screenshot({ path: '.shots/mobile-laws.png' })
  await page.getByRole('button', { name: 'Hide laws', exact: true }).last().click()
  const webgl = await page.locator('canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
  assert.ok(webgl.width > 0 && webgl.height > 0)
  assert.deepEqual(errors, [])
  console.log('Verified rendering, playback, speed, law sliders, field modes, import/export, and mobile sidebar.', webgl)
} finally {
  await browser.close()
}
