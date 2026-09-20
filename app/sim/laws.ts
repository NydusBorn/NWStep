/**
 * THE LAW REGISTRY.
 *
 * This is the product. Every physical constant and every exponent in the simulation
 * is declared here exactly once, and nowhere else. A single declaration produces the
 * physics term, the sidebar slider, the default value, the save payload, the import
 * validator and the tooltip.
 *
 * Rule: no physical constant may appear as a numeric literal anywhere else in sim/.
 * If it did, it could not become a slider, and the whole concept -- a universe whose
 * laws the player edits -- would quietly die.
 */

export interface LawDef {
  key: string
  group: LawGroup
  label: string
  value: number
  min: number
  max: number
  step: number
  /** The equation this law appears in. Shown in the tooltip, so the player is
   *  editing a visible formula rather than an opaque knob. */
  formula: string
  hint: string
  unit?: string
  /** Changing this law invalidates the terrain and requires regeneration. */
  rebuildsTerrain?: boolean
  relaunchesOrbits?: boolean
}

export type LawGroup
  = | 'System'
    | 'Gravitation'
    | 'Rotation'
    | 'Thermodynamics'
    | 'Fluid'
    | 'Clouds'
    | 'Electrics'
    | 'Geology'

export const LAW_GROUPS: LawGroup[] = [
  'System', 'Gravitation', 'Rotation', 'Thermodynamics', 'Fluid', 'Clouds', 'Electrics', 'Geology'
]

export const LAW_DEFS: LawDef[] = [
  {
    key: 'planetRadiusKm', group: 'System', label: 'Planet radius',
    value: 6000, min: 2000, max: 12000, step: 100, unit: 'km', rebuildsTerrain: true,
    formula: 'M = 4πρR³/3, g = GM/R²',
    hint: 'Physical radius at the configured density. Updates mass, gravity, relief, tidal displacement and wind-speed units. Moon orbits are measured in planet radii.'
  },
  {
    key: 'starDistance', group: 'System', label: 'Distance to star',
    value: 1, min: 0.5, max: 3, step: 0.05, unit: '× initial',
    formula: 'S = S₀/d², T_year ∝ d^(3/2)',
    hint: 'Move the planet closer to or farther from its star. Twice the distance gives one quarter of the stellar flux and a longer year. The star also appears smaller. This is a circular orbit, not a full star–planet gravity solver.'
  },
  {
    key: 'innerOrbitRadius', group: 'System', label: 'Inner moon orbit radius',
    value: 4, min: 2, max: 25, step: 0.1, unit: 'Rₚ', relaunchesOrbits: true,
    formula: 'v² = GM/r^(p−1), ζ ∝ r^(−p−1)',
    hint: 'Distance from the planet centre, in planet radii. Editing an orbit relaunches both moons on circular orbits and clears rewind history. Closer moons cause stronger tides; nearby or crossing orbits can be unstable.'
  },
  {
    key: 'outerOrbitRadius', group: 'System', label: 'Outer moon orbit radius',
    value: 20, min: 3, max: 45, step: 0.1, unit: 'Rₚ', relaunchesOrbits: true,
    formula: 'T = 2π√(r^(p+1)/GM)',
    hint: 'Launch radius of the outer moon, measured from the planet centre. Changes relaunch both moons. Check Hill separation in the readouts when bringing the orbits closer together.'
  },
  {
    key: 'innerOrbitInclination', group: 'System', label: 'Inner moon inclination',
    value: 0, min: 0, max: 180, step: 1, unit: '°', relaunchesOrbits: true,
    formula: 'v_y = v·sin i, v_z = v·cos i',
    hint: 'Orbit tilt relative to the equator. 0° is prograde equatorial, 90° polar and 180° retrograde. Relaunches both moons.'
  },
  {
    key: 'outerOrbitInclination', group: 'System', label: 'Outer moon inclination',
    value: 1.25 * 180 / Math.PI, min: 0, max: 180, step: 1, unit: '°', relaunchesOrbits: true,
    formula: 'v_y = v·sin i, v_z = v·cos i',
    hint: 'Tilt of the outer orbit. Inclined moons can exchange orbital energy. Relaunches both moons.'
  },
  {
    key: 'verticalExchange', group: 'Fluid', label: 'Vertical exchange',
    value: 1, min: 0, max: 3, step: 0.05,
    formula: 'w ∝ −∇·v_surface + orographic lift',
    hint: 'Transfers dust, vapour and condensate between the surface and upper layer. Rising air escapes surface convergence zones.'
  },
  {
    key: 'upperAltitude', group: 'Clouds', label: 'Upper layer altitude',
    value: 25, min: 2, max: 60, step: 1, unit: 'km',
    formula: 'T_upper → T_surface − Γ·H',
    hint: 'Representative altitude of the second atmosphere layer. Cooling permits lifted moisture to condense away from its surface source.'
  },
  {
    key: 'upperDrag', group: 'Fluid', label: 'Upper atmosphere drag',
    value: 0.035, min: 0.005, max: 0.3, step: 0.005,
    formula: 'v_upper ← v_upper·exp(−β_upper·dt)',
    hint: 'Damping of winds aloft, independently of ground roughness and cavern drag.'
  },
  {
    key: 'upperThermalTime', group: 'Thermodynamics', label: 'Upper thermal response',
    value: 30, min: 2, max: 200, step: 1, unit: 'ticks',
    formula: 'dT_upper/dt = (T_equilibrium − T_upper)/τ',
    hint: 'Thermal response time of the upper layer; its temperature is also transported by upper winds.'
  },
  // ---------------------------------------------------------------- Gravitation
  {
    key: 'G', group: 'Gravitation', label: 'Gravitational constant  ×G',
    value: 1, min: 0.05, max: 4, step: 0.01, rebuildsTerrain: true,
    formula: 'F = G·m₁m₂ / r^p',
    hint: 'A multiplier on Newton\'s constant, so 1 means real gravity. It scales the orbits, '
      + 'the surface gravity, and — because oblateness is the ratio of centrifugal to gravitational '
      + 'pull — the shape of the planet. Raise it and the world becomes rounder.'
  },
  {
    key: 'gravityExponent', group: 'Gravitation', label: 'Gravity exponent  p',
    value: 2, min: 1.2, max: 3.2, step: 0.01,
    formula: 'F = G·m₁m₂ / r^p',
    hint: 'Newton says 2. At 2.1 orbits precess; above ~3 they are unstable and spiral in. '
      + 'It also changes the tide: the degree-2 tidal term scales as p(p+1)/6 · (R/d)^(p+1), '
      + 'so a different exponent gives the planet a different bulge.'
  },
  {
    key: 'planetDensity', group: 'Gravitation', label: 'Planet density  ρ',
    value: 3900, min: 1200, max: 8000, step: 50, unit: 'kg/m³', rebuildsTerrain: true,
    formula: 'M = 4/3·πR³ρ,  g = GM/R²',
    hint: 'Sets the planet\'s mass and therefore its surface gravity. 3900 is Mars-like. '
      + 'A light planet cannot hold itself against its own spin and flattens dramatically.'
  },
  {
    key: 'loveNumberH2', group: 'Gravitation', label: 'Love number  h₂',
    value: 1.95, min: 0, max: 3, step: 0.01,
    formula: 'f = (h₂/2)·m,   ζ = h₂·(m/M)·R⁴/d³',
    hint: 'How far the body yields to a degree-2 potential. 0 is perfectly rigid and stays a sphere; '
      + '2.5 is a homogeneous fluid; 1.95 reproduces Earth\'s real flattening. It governs both the '
      + 'rotational bulge and the tidal bulge, because both are responses to the same kind of forcing.'
  },

  {
    key: 'shapeRelaxationDays', group: 'Gravitation', label: 'Rock relaxation time',
    value: 30, min: 1, max: 1000, step: 1, unit: 'days',
    formula: 'dε/dt = (ε_equilibrium − ε)/τ',
    hint: 'Modelled response time of the rocky body. After this many days it has moved '
      + '63% toward its equilibrium ellipsoid. Filters daily tides while allowing slow deformation.'
  },

  // ------------------------------------------------------------------- Rotation
  {
    key: 'rotationPeriod', group: 'Rotation', label: 'Rotation period',
    value: 50.27, min: 8, max: 2000, step: 0.01, unit: 'ticks', rebuildsTerrain: true,
    formula: 'Ω = 2π/T,  f = c·Ω·sin φ,  m = Ω²R³/GM',
    hint: 'One law, three consequences: it is the length of a day, it sets the Coriolis parameter '
      + 'that bands the atmosphere into jet streams, and it sets the centrifugal flattening that '
      + 'makes the planet an ellipsoid. The default equals the inner moon\'s orbital period, which '
      + 'is the mutual tidal lock plan.md describes: the bulge then stands still on the ground '
      + 'instead of sweeping across it. Detune it and the tide starts to travel. '
      + 'One tick is 15 simulated minutes.'
  },
  {
    key: 'coriolisCoupling', group: 'Rotation', label: 'Coriolis coupling  c',
    value: 2, min: 0, max: 6, step: 0.01,
    formula: 'a_cor = −c·Ω·sin(φ)·(ŷ × v)',
    hint: 'The 2 in the real Coriolis term. Set it to 0 and the jet streams dissolve into '
      + 'purely radial convection — the clearest single demonstration in this app of what rotation '
      + 'does to an atmosphere.'
  },
  {
    key: 'axialTilt', group: 'Rotation', label: 'Axial tilt',
    value: 0.25, min: 0, max: 1.2, step: 0.01, unit: 'rad',
    formula: 'δ = tilt·sin(2πt/T_year)',
    hint: 'Solar declination swing. Zero means no seasons.'
  },

  // ------------------------------------------------------------- Thermodynamics
  {
    key: 'solarConstant', group: 'Thermodynamics', label: 'Stellar flux',
    value: 1100, min: 0, max: 3000, step: 10, unit: 'W/m²',
    formula: 'E_in = (S₀/d²)·max(0, n̂·ŝ)·(1−A)',
    hint: 'Stellar flux at the initial star distance. Actual heating also follows the Distance to star control in System.'
  },
  {
    key: 'emissionExponent', group: 'Thermodynamics', label: 'Radiative cooling exponent  n',
    value: 4, min: 1, max: 6, step: 0.05,
    formula: 'E_out = σ·T^n',
    hint: 'Stefan–Boltzmann says 4. The coefficient σ is renormalised so the baseline equilibrium '
      + 'temperature stays put — what changes is the *stiffness* of the thermostat. Below ~3 the planet '
      + 'barely resists heating: gradients blow out and winds go wild. Above ~5 it sheds heat too eagerly.'
  },
  {
    key: 'albedo', group: 'Thermodynamics', label: 'Albedo',
    value: 0.22, min: 0, max: 0.95, step: 0.01,
    formula: 'E_in = S·(1−A)·…',
    hint: 'Fraction of incoming flux reflected straight back to space. Dusty regolith is around 0.25.'
  },
  {
    key: 'greenhouse', group: 'Thermodynamics', label: 'Greenhouse retention',
    value: 0.3, min: 0, max: 0.9, step: 0.01,
    formula: 'E_out ← E_out·(1−g)',
    hint: 'Fraction of outgoing radiation the atmosphere sends back down.'
  },
  {
    key: 'thermalInertia', group: 'Thermodynamics', label: 'Thermal inertia',
    value: 240, min: 5, max: 3000, step: 5,
    formula: 'dT/dt = (E_in − E_out)/C',
    hint: 'Low inertia means the surface tracks the sun instantly — a violent day/night contrast and '
      + 'chaotic winds. High inertia averages the day out, leaving a clean latitude gradient and banded jets. '
      + 'Bare rock has low inertia, which is why a barren world swings so hard between day and night.'
  },
  {
    key: 'caveBuffering', group: 'Thermodynamics', label: 'Cavern thermal buffer',
    value: 3, min: 0, max: 12, step: 0.1,
    formula: 'C ← C·(1 + b·cave)',
    hint: 'Rock is thermally massive and a cave is shielded from the sky, so a cavern barely '
      + 'feels the day/night swing that whips the open surface. Since pressure here is built '
      + 'from temperature, a cave field becomes a patch of steady pressure the weather flows around.'
  },
  {
    key: 'lapseRate', group: 'Thermodynamics', label: 'Lapse rate',
    value: 0.9, min: 0, max: 4, step: 0.01, unit: 'K/km',
    formula: 'T_eff = T − Γ·h',
    hint: 'How much colder the air gets with elevation. Makes the high ground cold.'
  },

  // ---------------------------------------------------------------------- Fluid
  {
    key: 'continuityCoupling', group: 'Fluid', label: 'Convergence pressure',
    value: 12, min: 0, max: 40, step: 0.5,
    formula: 'dp/dt = −K·∇·v − p/τ',
    hint: 'Air accumulating in a convergence raises pressure and redirects the wind. '
      + 'At zero, the warm equator can remain a permanent sink.'
  },
  {
    key: 'momentumAdvection', group: 'Fluid', label: 'Momentum transport',
    value: 0.65, min: 0, max: 1, step: 0.01,
    formula: 'Dv/Dt = ∂v/∂t + (v·∇)v',
    hint: 'Wind carries its own momentum, allowing jets and terrain-driven eddies to evolve.'
  },
  {
    key: 'pressureCoupling', group: 'Fluid', label: 'Pressure-gradient force  α',
    value: 0.6, min: 0, max: 5, step: 0.01,
    formula: 'a = −α·∇p',
    hint: 'How hard a pressure difference pushes air. This is the engine of all wind.'
  },
  {
    key: 'thermalPressure', group: 'Fluid', label: 'Thermal → pressure coupling',
    value: 1.4, min: 0, max: 6, step: 0.01,
    formula: 'p = p₀ − k·(T − T̄) − b·h',
    hint: 'Hot air rises and leaves low pressure behind. Set to 0 and only terrain drives pressure.'
  },
  {
    key: 'orographicPressure', group: 'Fluid', label: 'Elevation → pressure  b',
    value: 0.5, min: 0, max: 3, step: 0.01,
    formula: 'p = p₀ − k·(T − T̄) − b·h',
    hint: 'Thinner air over high ground.'
  },
  {
    key: 'dragCoefficient', group: 'Fluid', label: 'Surface drag  β',
    value: 0.12, min: 0.001, max: 1.5, step: 0.001,
    formula: 'a_drag = −β·(1 + roughness)·v',
    hint: 'Friction against the ground, amplified by terrain roughness. Crank it up and wind can never organise.'
  },
  {
    key: 'terrainBlocking', group: 'Fluid', label: 'Terrain blocking',
    value: 0.7, min: 0, max: 2, step: 0.01,
    formula: 'v ← v − k·(v·∇h)⁺·∇ĥ',
    hint: 'Wind cannot climb a steep slope; it is deflected along the contour instead. '
      + 'This is what turns mountain ranges and crater rims into stream-shaping structures. '
      + 'Set to 0 and the jets go flat and boring.'
  },
  {
    key: 'advectionStrength', group: 'Fluid', label: 'Heat advection',
    value: 0.4, min: 0, max: 4, step: 0.01,
    formula: 'dT/dt ← −s·(v·∇T)',
    hint: 'How strongly the wind drags temperature around with it. Near 1 the winds cross a cell '
      + 'faster than radiation can act, so the surface stops following the sun at all and temperature '
      + 'becomes purely a transport pattern.'
  },
  {
    key: 'caveTrapping', group: 'Fluid', label: 'Cavern drag',
    value: 1.4, min: 0, max: 6, step: 0.01,
    formula: 'a_drag = −β·(1 + roughness + k·cave)·v',
    hint: 'How strongly a cavernous cell holds the air passing over it. A cave field is a '
      + 'momentum sink — wind entering it stalls — which is why the ground below a karst ridge '
      + 'is calm while the ridge itself is not.'
  },
  {
    key: 'caveConduction', group: 'Fluid', label: 'Cavern conduits',
    value: 0.5, min: 0, max: 3, step: 0.01,
    formula: 'Q = k·Δp between linked mouths',
    hint: 'Air driven through a tunnel by the pressure difference between its two mouths, '
      + 'carrying heat with it. This is what makes a cave system a shortcut THROUGH an obstacle '
      + 'rather than merely a hole in the ground.'
  },
  {
    key: 'viscosity', group: 'Fluid', label: 'Viscosity',
    value: 0.08, min: 0, max: 0.6, step: 0.001,
    formula: '∂X/∂t += ν·∇²X',
    hint: 'Smoothing between neighbouring cells. Also the numerical safety net — at 0 the solver gets noisy.'
  },

  // --------------------------------------------------------------------- Clouds
  {
    key: 'cloudAutoconversion', group: 'Clouds', label: 'Autoconversion threshold  q_c',
    value: 0.00012, min: 0, max: 0.002, step: 0.00001,
    formula: 'Δcloud = −(q_c_cloud − q_c)⁺·(1 − e^(−k·dt))',
    hint: 'Cloud water a cell must carry before its droplets are big enough to fall. Below it '
      + 'a cloud just drifts; above it, rain scales with the excess, so a dense cloud empties '
      + 'itself fast. Set it to zero and every cloud decays at the same rate whatever its '
      + 'size, which leaves the sky permanently and uniformly overcast.'
  },
  {
    key: 'cloudFallout', group: 'Clouds', label: 'Condensate fallout',
    value: 0.03, min: 0, max: 0.05, step: 0.0001,
    formula: 'dcloud/dt = −k·cloud,  dfrost/dt = k·cloud',
    hint: 'Condensed material settles back to the ground. Prevents cold regions '
      + 'from accumulating an unlimited permanent cloud cap.'
  },
  {
    key: 'frostLine', group: 'Clouds', label: 'Frost line',
    value: 9, min: 0, max: 60, step: 0.5, unit: 'km',
    formula: 'frost = (h − L)/L  for h > L',
    hint: 'Elevation above which frost survives on the rock. This small reserve on the cold '
      + 'high ground is the only water the world has, so it is the only thing that can make an '
      + 'ice cloud — and therefore the only thing that can make a storm.'
  },
  {
    key: 'vapourSupply', group: 'Clouds', label: 'Sublimation rate',
    value: 1.6, min: 0, max: 5, step: 0.01,
    formula: 'dq/dt = S·frost',
    hint: 'How fast the frost turns straight to vapour. Raise it and the ranges start smoking.'
  },
  {
    key: 'orographicLift', group: 'Clouds', label: 'Orographic lift',
    value: 1.2, min: 0, max: 5, step: 0.01,
    formula: 'w += k·(v·∇h)⁺',
    hint: 'Wind forced up a slope. Air only condenses when something lifts it, and on a world '
      + 'with 45 km of relief the mountains do most of the lifting — which is why the cloud '
      + 'sits over the ranges.'
  },
  {
    key: 'convergenceLift', group: 'Clouds', label: 'Convergent lift',
    value: 2.4, min: 0, max: 5, step: 0.01,
    formula: 'w += k·(−∇·v)⁺',
    hint: 'Air piling into a region has nowhere to go but up. Orographic lift is pinned to the '
      + 'terrain, so a cloud built only that way hangs over its ridge and never goes anywhere — '
      + 'which is what a real lenticular cloud does. This is the term that makes weather instead: '
      + 'cloud along the moving streamline confluences, which then travels with them.'
  },
  {
    key: 'condensation', group: 'Clouds', label: 'Condensation rate',
    value: 0.5, min: 0, max: 3, step: 0.01,
    formula: 'q_s = 0.622·e_s/(p−e_s),  Δcloud = (q − q_s)⁺',
    hint: 'How readily supersaturated air gives up its vapour. Saturation itself comes from the '
      + 'Magnus form, using the ICE curve below freezing — which sits lower than the liquid one, '
      + 'so a cold world clouds over more easily than you would expect.'
  },
  {
    key: 'cloudDecay', group: 'Clouds', label: 'Cloud evaporation',
    value: 0.08, min: 0, max: 1, step: 0.005,
    formula: 'Δcloud = −k·cloud  when sub-saturated',
    hint: 'How fast cloud returns to vapour once the lifting stops. Low values leave long '
      + 'downwind plumes trailing off the ranges.'
  },
  {
    key: 'dustLifting', group: 'Clouds', label: 'Dust lifting  C',
    value: 1, min: 0, max: 5, step: 0.01,
    formula: 'Q = C·(u*³ − u*t³),  u*² = C_d·U²',
    hint: 'Dust does not lift directly — sand-sized grains saltate first and blast it free. '
      + 'Bagnold\'s result, still the standard, is that the flux goes as the CUBE of the friction '
      + 'velocity, which is why dust storms switch on rather than fade in.'
  },
  {
    key: 'dustThreshold', group: 'Clouds', label: 'Saltation threshold  u*t',
    value: 0.002, min: 0, max: 0.02, step: 0.0001,
    formula: 'lifting only where u* > u*t',
    hint: 'Below this friction velocity nothing moves at all. Lower it and the whole planet '
      + 'hazes over; raise it and only the jets can raise dust.'
  },
  {
    key: 'dustGustiness', group: 'Clouds', label: 'Gustiness  I',
    value: 0.4, min: 0, max: 2, step: 0.01,
    formula: 'Q = C·softplus(u*³ − u*t³, 3I·u*³)',
    hint: 'The saltation threshold applies to the instantaneous friction velocity, and a '
      + '200 km cell does not have one — turbulence spreads it about the cell mean, so a cell '
      + 'sitting below threshold still lifts from the gusty tail. At zero the cutoff is hard '
      + 'and calm ground becomes a dust trap it can never escape: storms bury their dust in '
      + 'the quiet cells and the sky clears permanently.'
  },
  {
    key: 'tracerLofting', group: 'Clouds', label: 'Vertical tracer exchange',
    value: 1, min: 0, max: 4, step: 0.01,
    formula: 'Δaloft = load·(1 − e^(−exchange·L·dt))',
    hint: 'How strongly rising air carries dust, cloud and vapour into the upper layer, and '
      + 'sinking air brings them back. At zero the surface layer is sealed and convergence '
      + 'zones fill for ever — the equator ends up holding everything and the rest of the '
      + 'planet is swept clean. Raise it and storms vent upward and spread downwind.'
  },
  {
    key: 'dustSettling', group: 'Clouds', label: 'Dust settling',
    value: 0.003, min: 0, max: 0.3, step: 0.001,
    formula: 'Δdust = −k·dust',
    hint: 'Gravitational fallout. It is what decides whether a storm clears in hours or hangs '
      + 'over the planet for a season.'
  },
  {
    key: 'cloudCoverage', group: 'Clouds', label: 'Coverage',
    value: 0.7, min: 0, max: 1, step: 0.01,
    formula: 'd ← d − (1−coverage)·k',
    hint: 'Display: where the procedural detail is cut away to leave clear sky. Does not change '
      + 'the simulated cloud mass, only how much of it is drawn.'
  },
  {
    key: 'cloudDetail', group: 'Clouds', label: 'Detail scale',
    value: 1.4, min: 0.1, max: 4, step: 0.01,
    formula: 'fbm(p·scale) dilated by billow',
    hint: 'Display: the frequency of the fractal detail that breaks up the 200 km simulation '
      + 'cells into something cloud-shaped.'
  },

  // ------------------------------------------------------------------- Electrics
  {
    key: 'chargeRate', group: 'Electrics', label: 'Non-inductive charging',
    value: 1.2, min: 0, max: 6, step: 0.01,
    formula: 'dQ/dt ∝ cloud·4f(1−f)·exp(−((T+15)/9)²)·w',
    hint: 'Lightning needs rebounding collisions between graupel and ice crystals with '
      + 'supercooled water present. So charging only happens in the MIXED-PHASE band — it peaks '
      + 'where the ice fraction is one half and dies where the cloud is all liquid or all ice — '
      + 'and it is strongest near −15 °C. An all-dust cloud can never do this.'
  },
  {
    key: 'dustCharge', group: 'Electrics', label: 'Triboelectric charging',
    value: 0.6, min: 0, max: 4, step: 0.01,
    formula: 'dQ/dt ∝ dust·|v|',
    hint: 'A dry dust storm charges by friction alone. Real — Martian dust devils do it — but '
      + 'far weaker than the ice mechanism. Raise it if you want a world that thunders without water.'
  },
  {
    key: 'chargeLeak', group: 'Electrics', label: 'Charge leakage',
    value: 0.05, min: 0, max: 0.6, step: 0.001,
    formula: 'dQ/dt −= k·Q',
    hint: 'Conduction bleeding the separated charge away between strikes.'
  },
  {
    key: 'breakdownField', group: 'Electrics', label: 'Breakdown threshold',
    value: 1, min: 0.05, max: 6, step: 0.01,
    formula: 'Q > threshold → discharge',
    hint: 'The field at which the air gives way and the cloud flashes. Lower it for a planet in '
      + 'permanent storm — which is the state plan.md wants for the residents to live in.'
  },

  // -------------------------------------------------------------------- Geology
  {
    key: 'reliefAmplitude', group: 'Geology', label: 'Relief amplitude',
    value: 45, min: 0, max: 100, step: 1, unit: 'km', rebuildsTerrain: true,
    formula: 'h = A·(base + belts)',
    hint: 'Peak mountain height. plan.md calls for rock up to 100 km — comparable to the atmospheric '
      + 'scale height, which is why summits become dead zones and canyons become wind tunnels.'
  },
  {
    key: 'plateCount', group: 'Geology', label: 'Tectonic plates',
    value: 14, min: 3, max: 30, step: 1, rebuildsTerrain: true,
    formula: 'belt = exp(−(k·(d₂−d₁))²)',
    hint: 'Mountains are uplifted along plate boundaries. This is what makes ranges linear instead of blobby.'
  },
  {
    key: 'plateDrift', group: 'Geology', label: 'Plate drift  ω',
    value: 1, min: 0, max: 2.5, step: 0.01, rebuildsTerrain: true,
    formula: 'v = ω × p,   c = (v_a − v_b)·n̂',
    hint: 'How fast the plates move about their Euler poles. It is the *relative* motion '
      + 'across a boundary that decides what happens there: pushing together builds mountains, '
      + 'pulling apart opens a rift, sliding past does almost nothing. Because that projection '
      + 'changes along a boundary, one belt can be a range at one end and a bare transform at the '
      + 'other — which is what puts gaps in a mountain chain. At 0 the plates are static and no '
      + 'boundary builds anything.'
  },
  {
    key: 'riftDepth', group: 'Geology', label: 'Rift depth',
    value: 0.5, min: 0, max: 1.5, step: 0.01, rebuildsTerrain: true,
    formula: 'h −= R·belt·max(0, −c)',
    hint: 'How deeply a divergent boundary cuts. Spreading centres are valleys, not ridges, '
      + 'so raising this carves long troughs through the boundary network and opens the wind up.'
  },
  {
    key: 'upliftRate', group: 'Geology', label: 'Boundary uplift',
    value: 1, min: 0, max: 2.5, step: 0.01, rebuildsTerrain: true,
    formula: 'h += U·belt·max(0, c)·stress(φ)',
    hint: 'How much a given rate of convergence raises mountains. Set to 0 for a smooth world '
      + 'with nothing to steer the wind.'
  },
  {
    key: 'spinOrogeny', group: 'Geology', label: 'Spin → mountain belts',
    value: 0.6, min: 0, max: 2, step: 0.01, rebuildsTerrain: true,
    formula: 'stress(φ) = 1 + k·(m/m₀)·(sin 2|φ| − ⅓)',
    hint: 'Centrifugal flattening puts the equator in extension and mid-latitudes in compression, so '
      + 'the rotation period decides *where* the mountains are. This coefficient scales that real stress, '
      + 'which is proportional to the rotational parameter m = Ω²R³/GM. Change the spin and the belts move.'
  },
  {
    key: 'craterDensity', group: 'Geology', label: 'Impact craters',
    value: 0.8, min: 0, max: 2.5, step: 0.01, rebuildsTerrain: true,
    formula: 'h += D·(x²−1)|ₓ₍₁ + rim·e^−((x−1)/w)²',
    hint: 'Number of impact basins, drawn from a power-law size distribution like a real cratered surface. '
      + 'Bowls with raised rims. On a world with no water to erase them, craters are most of the landscape — '
      + 'and their rims steer wind just as mountain ranges do.'
  },
  {
    key: 'caveDensity', group: 'Geology', label: 'Cavern systems',
    value: 0.8, min: 0, max: 3, step: 0.01, rebuildsTerrain: true,
    formula: 'n = D·45,  sited ∝ roughness',
    hint: 'How many cave systems riddle the crust. They open where the rock is most broken, '
      + 'so they follow the roughest ground. Caverns act on the wind locally rather than globally: '
      + 'they trap it, steady the temperature under it, and tunnel it through obstacles.'
  },
  {
    key: 'erosionRate', group: 'Geology', label: 'Erosion',
    value: 0.3, min: 0, max: 1, step: 0.01, rebuildsTerrain: true,
    formula: 'ridge ← (1−e)·sharp + e·smooth',
    hint: 'Blends sharp ridges toward their low-frequency envelope. High erosion eventually removes the '
      + 'wind\'s steering structure.'
  },
  {
    key: 'datumLevel', group: 'Geology', label: 'Datum level',
    value: 0, min: -30, max: 40, step: 0.5, unit: 'km', rebuildsTerrain: true,
    formula: 'h ← h − datum',
    hint: 'Shifts the whole elevation field against the reference radius. There is no ocean on this world, '
      + 'so this only moves where the colour ramp puts its midpoint.'
  }
]

export type Laws = Record<string, number>

export function defaultLaws(): Laws {
  const l: Laws = {}
  for (const d of LAW_DEFS) l[d.key] = d.value
  return l
}

export function clampLaws(laws: Laws): Laws {
  const out: Laws = {}
  for (const d of LAW_DEFS) {
    const v = laws[d.key]
    out[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v as number)) : d.value
  }
  return out
}

export function lawsByGroup(): Record<LawGroup, LawDef[]> {
  const out = {} as Record<LawGroup, LawDef[]>
  for (const g of LAW_GROUPS) out[g] = LAW_DEFS.filter(d => d.group === g)
  return out
}

/** Laws whose change forces the terrain to be regenerated. */
export const TERRAIN_LAWS = new Set(LAW_DEFS.filter(d => d.rebuildsTerrain).map(d => d.key))
export const ORBIT_LAWS = new Set(LAW_DEFS.filter(d => d.relaunchesOrbits).map(d => d.key))
