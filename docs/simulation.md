# Time, shape and wind

Electrical colonies now share the atmosphere's charge supply with lightning.
See [colony rules and MVP](colonies.md) for feeding, population, inheritance and
inspection. When life is enabled or founders have been introduced, date jumps
always replay the full simulation to preserve ancestry. The approximate Fast jump
behaviour described below applies only to worlds without life.

The solid planet starts spherical and relaxes toward its equilibrium ellipsoid.
The default relaxation time is 30 simulated days (63% of a constant deformation
after 30 days). Rotation and every moon contribute to a symmetric strain tensor;
rotation stays aligned with the spin axis. This is a configurable response model
for rocky material, not a full geophysical rheology solver. Orbits use eight
integration substeps per weather tick. Changing playback speed does not change
the model's time constants.

**Fast jump** is on by default. Jumps longer than two days advance orbits and solid
shape using the same global integration as playback, skip the intervening weather,
seed a latitude-dependent mean climate, then simulate 24 destination weather ticks.
This makes distant dates useful for exploring global evolution. Destination weather
is approximate and its rewind history starts on arrival. Disable Fast jump for
full weather replay. Both paths yield between short batches and pause at arrival.
Dates outside saved history rebuild from the seed under the current laws.

Weather runs on 2,562 cells, with pressure feedback from convergence, momentum
transport, terrain blocking and cavern effects. The terrain still renders with
40,962 vertices. This is a single surface layer: it does not model Earth's full
three-dimensional Hadley/Ferrel circulation, and zooming cannot reveal weather
smaller than the simulated grid.

Wind is displayed as continuous streamlines with moving direction heads. Colour
shows speed. Zooming blends between 42, 162 and 642 seeds; inactive seeds are not
traced. The far view averages neighbouring winds; the near view shows local winds
and shorter paths. Parallel coincident segments combine their widths. Traces end
at stagnation instead of bouncing across a sink. The lines follow a conservative
local envelope of the detailed terrain, with clearance above mountain peaks.
Paths wholly outside the camera frustum or behind the solid planet are skipped
before tracing; their conservative bounds include the entire path and arrowheads.
GPU uploads cover only the segments emitted for the current view.

Pause freezes weather, cloud noise, cloud smoothing, solid deformation and wind
direction. Direction heads continue moving as indicators of the frozen wind field.
FPS, actual ticks/second and the number of traced streams are always visible.
New sessions start paused at day 0 so saved high playback speeds cannot advance
the world and create weather before the first inspection.

Cloud opacity uses fixed local optical-mass scales rather than the current global
maximum. Dust settles more slowly by default. Condensation uses local elevation
cooling, sunlight releases a finite frost reserve, and condensate falls back to the
ground. Both dust and condensate are advected; procedural cloud detail also follows
the local wind. Fullbright bypasses cloud shadows and view-dependent scattering.

Cloud, vapour and dust transport exchanges paired fluxes between adjacent cells,
conserving their summed loading on the approximately equal-area grid. Adaptive
substeps prevent negative amounts at large Courant numbers. This remains a
diffusive first-order surface model, not a resolved turbulent atmosphere. Loose
surface dust is finite: lifting depletes it and settling deposits it elsewhere.
The inventory is included in rewind checkpoints and reinitialised by fast jumps.

Sub-grid cloud texture uses two staggered, renewing flow maps. Their backtraces
are bounded to 16 simulation ticks and renew at zero weight, preventing the old
unbounded per-cell UV shear. Pattern generations differ so they do not repeatedly
snap back to a fixed terrain texture. Cloud mass and detail use simulation time;
displayed loading eases over two ticks rather than averaging many days at high
playback speeds. Texture is illustrative detail, not additional simulated mass.
The shell evaluates six noise octaves per fragment and uses slab attenuation,
replacing forty octave evaluations for the previous noise/shadow marches.

Run `pnpm test`, `pnpm typecheck` and `pnpm lint` for regression checks.

Paused-wind regression: `node scripts/verify-wind.mjs http://localhost:3123/`
requires the development server. It checks wheel zoom without advancing time,
the global readouts, recovery after a solver stop, and rewind recovery at day 0.
Screenshots are written to `.shots/paused-wind-*.png`.

## System size and orbital controls

The `System` group accepts sliders or exact numeric values (commit a typed value by leaving the field):

- Planet radius: 2,000–12,000 km. At fixed density, mass scales with R³ and surface gravity with R. Terrain, tidal offsets and wind-speed conversion use this radius. The camera keeps its physical distance while editing the radius, subject to its zoom limits.
- Distance to star: 0.5–3 times the original orbit. Received flux is the configured Stellar flux divided by distance squared. The prescribed circular stellar orbit has a period proportional to distance^(3/2), independent of planetary spin; its baseline is the original ten-day year. The displayed star distance is illustrative, not an AU scale or a full star–planet N-body integration.
- Inner/outer moon launch radii: measured from the planet centre in Rₚ (planet radii). Inclinations range from 0° through polar at 90° to retrograde at 180°. Editing any orbital control relaunches both moons and clears rewind history. Their circular launch velocities, tidal forcing and the tidal-lock shortcut use the selected radii. Close or crossing orbits are intentionally allowed and may be unstable.

Moon mass/radius ratios remain the existing defaults. With fixed density and moon radius measured in Rₚ, changing planet radius preserves the dimensionless orbital period; changing density affects orbital gravity. The existing orbital time calibration is retained for compatibility with the default system.

The readout shows planet mass, received flux, year length and current moon distances in kilometres. New parameters participate in settings/timestep export and local persistence. Older files receive the original defaults for absent parameters.

Run `node scripts/verify-system.mjs http://localhost:3123/` against the development server to check edits, relaunches, export/import, persistence and input bounds.
