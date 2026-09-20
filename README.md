# Nuxt Starter Template

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)

Use this template to get started with [Nuxt UI](https://ui.nuxt.com) quickly.

- [Live demo](https://starter-template.nuxt.dev/)
- [Documentation](https://ui.nuxt.com/docs/getting-started/installation/nuxt)

<a href="https://starter-template.nuxt.dev/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://ui.nuxt.com/assets/templates/nuxt/starter-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://ui.nuxt.com/assets/templates/nuxt/starter-light.png">
    <img alt="Nuxt Starter Template" src="https://ui.nuxt.com/assets/templates/nuxt/starter-light.png" width="830" height="466">
  </picture>
</a>

> The starter template for Vue is on https://github.com/nuxt-ui-templates/starter-vue.

## Quick Start

```bash [Terminal]
npm create nuxt@latest -- -t ui
```

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-name=starter&repository-url=https%3A%2F%2Fgithub.com%2Fnuxt-ui-templates%2Fstarter&demo-image=https%3A%2F%2Fui.nuxt.com%2Fassets%2Ftemplates%2Fnuxt%2Fstarter-dark.png&demo-url=https%3A%2F%2Fstarter-template.nuxt.dev%2F&demo-title=Nuxt%20Starter%20Template&demo-description=A%20minimal%20template%20to%20get%20started%20with%20Nuxt%20UI.)

## Setup

Make sure to install the dependencies:

```bash
pnpm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
pnpm dev
```

## Production

Build the application for production:

```bash
pnpm build
```

Locally preview production build:

```bash
pnpm preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Renovate integration

Install [Renovate GitHub app](https://github.com/apps/renovate/installations/select_target) on your repository and you are good to go.

## Simulation controls and verification

The interface keeps main's inset sidebar, rounded canvas workspace and playback/import/export toolbar, with the simulation from `system-mvp`. Nuxt UI provides the sidebar, buttons, sliders, day input, checkbox and status alerts. On small screens the laws open in a drawer.

Use Resume/Pause and the speed buttons to control time; negative speeds replay recorded history. Go to day can rebuild earlier history, and Fast jump approximates destination weather for long forward jumps. The sidebar edits physical laws, regenerates terrain and resets or relaunches the system. Canvas controls select fields, streamlines, cloud highlighting and fullbright; click the planet to inspect a cell.

Settings exports contain the seed and laws. Timestep exports additionally contain the tick. Importing a timestep reconstructs the world and replays to that tick under the exported laws; it does not restore a complete snapshot or a history of law edits. Disable Fast jump for full weather replay.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` for checks. For browser checks:

```bash
pnpm exec playwright install chromium
pnpm dev --port 3123
# In another terminal:
node scripts/verify.mjs http://localhost:3123/
```

The script checks rendering and interactive controls, captures desktop and mobile screenshots in `.shots/`, and fails on browser errors. To use installed Edge instead of downloaded Chromium, set `PLAYWRIGHT_CHANNEL=msedge` (PowerShell: `$env:PLAYWRIGHT_CHANNEL = 'msedge'`).
