// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultAttributes } from 'eslint-plugin-better-tailwindcss/api/defaults'

export default withNuxt(
  betterTailwindcss.configs['correctness-error'],
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'app/assets/css/main.css',
        attributes: [
          ...getDefaultAttributes(),
          ['^v-bind:ui$', [{ match: 'objectValues' }]]
        ]
      }
    }
  }
).append({
  // The simulation and render kernels are dense vector maths. Splitting
  // component-wise operations such as `ex /= el; ey /= el; ez /= el` across
  // three lines each makes them materially harder to read, not easier, so this
  // one stylistic rule is relaxed here and nowhere else.
  files: ['app/sim/**/*.ts', 'app/render/**/*.ts'],
  rules: {
    '@stylistic/max-statements-per-line': 'off'
  }
})
