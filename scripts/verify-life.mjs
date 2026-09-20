import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { createWorld, stepWorld } = require('../app/sim/world.ts')

const w = createWorld(Number(process.argv[4] ?? 20260919))
const scenario = process.argv[3] ?? 'baseline'
const variants = {
  baseline: {},
  legacy: { lifeMaintenance: 0.00012, lifeReserveTicks: 16, lifeHarvest: 6, lifeGrowth: 0.04, lifeMutation: 0.12 },
  lowcost: { lifeMaintenance: 0.0000012 },
  mediumcost: { lifeMaintenance: 0.000003 },
  highcost: { lifeMaintenance: 0.000006 }
}
if (!(scenario in variants)) throw new Error('Unknown life scenario')
Object.assign(w.laws, variants[scenario])
const duration = Math.ceil(Number(process.argv[2] ?? 20) * w.laws.rotationPeriod)
const interval = Math.ceil(w.laws.rotationPeriod * 10)
let food = 0, costs = 0
for (let t = 0; t < duration; t++) {
  stepWorld(w, false)
  food += w.life.colonies.reduce((s, c) => s + c.fed, 0)
  costs += w.life.colonies.reduce((s, c) => s + c.cost, 0)
  if (w.tick % interval === 0 || t === duration - 1) {
    console.log(JSON.stringify({ scenario, day: +(w.tick / w.laws.rotationPeriod).toFixed(1), colonies: w.life.colonies.length,
      population: w.life.colonies.reduce((sum, c) => sum + c.positive + c.negative, 0),
      births: w.life.births, deaths: w.life.deaths, starved: w.life.starved, crowded: w.life.crowded,
      merges: w.life.merges, dispersals: w.life.dispersals, foodCost: +(food / Math.max(costs, 1e-12)).toFixed(3),
      generation: Math.max(0, ...w.life.colonies.map(c => c.generation)),
      efficiency: w.life.colonies.length ? w.life.colonies.reduce((s, c) => s + c.traits.efficiency, 0) / w.life.colonies.length : 0 }))
    food = 0
    costs = 0
  }
}
