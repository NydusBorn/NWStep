import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:3123/'

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'
  ]
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(10000)
await page.screenshot({ path: '.shots/a1.png' })
await page.waitForTimeout(6000)
await page.screenshot({ path: '.shots/a2.png' })

// Orbit the camera to inspect the day side.
await page.mouse.move(640, 400)
await page.mouse.down()
await page.mouse.move(300, 380, { steps: 20 })
await page.mouse.up()
await page.waitForTimeout(2500)
await page.screenshot({ path: '.shots/a3.png' })

const webgl = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  return { hasCanvas: !!canvas, w: canvas?.width, h: canvas?.height }
})

console.log('webgl canvas:', JSON.stringify(webgl))
console.log(errors.length ? errors.join('\n') : 'no console/page errors')
await browser.close()
