import * as THREE from 'three'
import type { World } from '../sim/world'
import { interpolateToMesh } from '../sim/icosphere'

/** The shell displays transported mass. Cloud MOTION comes from that mass, which the
 * solver advects at the true wind speed; the sub-grid noise here only breaks the
 * 200 km cells into cloud-shaped structure.
 *
 * That noise does not chase the wind. It used to: two flow maps warped by local wind,
 * crossfading as each renewed. Measured against this world it could not work -- one
 * 16-tick period sheared the pattern through 2.6 feature widths at median wind and 6
 * at maximum, so the texture smeared and snapped back 3.75 times a second at x1 and
 * 60 at x16. Bounded shear would have needed a ~2.5-tick period, which is faster
 * still, and no tick-based period can be slow at high playback speed anyway.
 *
 * So the volume is fixed in the planet's rotating frame and drifts on a CLOSED loop
 * instead. A rigid translation cannot shear, a closed loop never grows coordinates
 * that float32 noise would lose precision on, and neither ever needs a reset to hide.
 * These are visual details, not extra sources of simulated cloud/dust mass. */
/** How far the detail volume is carried from the origin. Larger crosses more noise
 *  features per lap, so the pattern varies more before it repeats; small enough that
 *  the coordinates stay in the range float32 value noise resolves cleanly. */
const BILLOW_RADIUS = 8
/** Ticks per lap. Deliberately slow: roughly one feature every 20 simulated days.
 *  The perceived motion of a cloud has to come from the MASS, which the solver
 *  advects at the true wind speed -- at x4 that is about 150 degrees of arc a second,
 *  plenty to see. A detail pattern that renews on a weather timescale churns 3 times
 *  a second at that playback rate and drowns the streaming out, which reads as clouds
 *  boiling in place rather than travelling. Slower here means the mass wins. */
const BILLOW_PERIOD_TICKS = 49152

/**
 * Mass giving optical depth 1, per material. These also decide the COLOUR, because
 * `iceShare` downstream is the ratio between the two opacities -- so they have to be
 * commensurate with the masses the solver actually produces, or the ratio stops
 * meaning anything.
 *
 * They were 0.00005 and 3, a factor of 60,000 apart, against peak masses of 5.2e-3
 * cloud and 1.8 dust. Cloud therefore ran 103x over its optical mass and pinned at
 * opacity 1.000 while dust reached 0.449, so ice won the ratio everywhere: a cell
 * holding 3,178x more dust than condensate still drew as an ice cloud, and only 21%
 * of visibly dusty cells came out ochre. Scaled to the real mass ranges it is 81%,
 * and a dust storm looks like one.
 */
const CLOUD_OPTICAL_MASS = 0.0005
const DUST_OPTICAL_MASS = 1
/** Beyond this a column is opaque anyway, and the attribute stays well conditioned. */
const MAX_OPTICAL_DEPTH = 8

const cloudVert = /* glsl */`
attribute float aCloud;
attribute float aIce;
attribute float aDust;
attribute float aCharge;
varying float vCloud;
varying float vIce;
varying float vDust;
varying float vCharge;
varying vec3 vObj;
varying vec3 vView;

void main() {
  vCloud = aCloud;
  vIce = aIce;
  vDust = aDust;
  vCharge = aCharge;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const cloudFrag = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uEvolve;
uniform float uDetail;
uniform float uExtinction;
uniform float uCoverage;
uniform float uFlash;
uniform vec3 uFlashPos;
uniform float uHighlight;
uniform float uFullbright;
varying float vCloud;
varying float vIce;
varying float vDust;
varying float vCharge;
varying vec3 vObj;
varying vec3 vView;

// --- value noise -----------------------------------------------------------
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.875;
}

/**
 * @param tau   optical depth of the whole column, unbounded above
 * @param cover the same, clamped to 0..1, for deciding where there is sky at all
 */
/**
 * Coverage mask for ONE material.
 *
 * Dust and condensate get their own sample. Sharing a single mask -- which is what
 * this did -- meant they shared an outline: a cell whose ice evaporated kept exactly
 * the same shape and merely changed hue, so a cloud appeared to lose its colour
 * rather than clear. With separate samples each material thins and vanishes on its
 * own, and a fragment is only drawn where something is actually left.
 *
 * uEvolve walks the sample volume along a closed loop, so the pattern billows
 * continuously and identically at any frame rate, and is still exactly where it was
 * when the simulation is paused.
 *
 * @param scale  spatial frequency; dust is sampled coarser because it travels as
 *               broad sheets where condensate is wispy.
 * @param offset displaces the domain so the two materials cannot correlate.
 */
float mask(vec3 p, float cover, float scale, vec3 offset) {
  float n = fbm(p * scale + uEvolve + offset);
  // The LOAD sets how much of the cell is covered; the noise only decides where
  // inside it the cloud sits. The cut this replaces moved by 0.12 across the entire
  // range of loads while the noise spanned 1.0, so the drawn shape was essentially
  // fixed and the simulation only scaled its opacity -- the picture showed THAT
  // something was there, never how much.
  float frac = clamp(cover * (0.35 + 1.3 * uCoverage), 0.0, 1.0);
  float cut = 1.0 - frac;
  return smoothstep(cut - 0.14, cut + 0.14, n);
}

// Henyey-Greenstein: the forward peak is what makes a cloud edge glow toward the star
float hg(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566370614 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}

void main() {
  vec3 p = normalize(vObj);
  // vCloud and vDust arrive as optical depths, so these are too, and Beer-Lambert
  // below turns the total into opacity ONCE. A thin deck is visibly thinner than a
  // storm, and each material is masked separately so each can clear on its own.
  float scale = 24.0 * uDetail;
  float dCloud = vCloud * mask(p, min(1.0, vCloud), scale, vec3(0.0));
  float dDust = vDust * mask(p, min(1.0, vDust), scale * 0.55, vec3(19.7, 4.3, 11.1));
  float d = dCloud + dDust * 0.75;
  if (d <= 0.0) discard;

  // optical depth through the slab, Beer-Lambert
  float alpha = 1.0 - exp(-d * uExtinction);

  // Slab attenuation uses the density already evaluated. Marching the same
  // eight-octave noise four more times dominated close-up fragment cost.
  float light = 1.0;
  if (uFullbright < 0.5) light = exp(-d * uExtinction * 0.55);

  float cosT = dot(normalize(vView), normalize(uSunDir));
  float phase = hg(cosT, 0.62) * 6.0 + 0.55;

  float lit = max(0.0, dot(p, normalize(uSunDir)));
  lit = mix(pow(lit, 0.7), 1.0, uFullbright);

  // ochre where the load is dust, pale where it is condensed ice
  // Built from the MASKED amounts, so shape and colour agree: where the dust mask
  // has cleared, the fragment reads as pure condensate rather than a muddied blend.
  float iceShare = dCloud / max(1e-4, dCloud + dDust * 0.75);
  vec3 dustCol = vec3(0.55, 0.36, 0.27);
  vec3 iceCol  = vec3(0.80, 0.83, 0.88);
  vec3 col = mix(dustCol, iceCol, iceShare * mix(0.45, 1.0, vIce));

  // a charged cloud is a deep cloud: the light stops getting through
  col *= mix(mix(1.0, 0.45, clamp(vCharge, 0.0, 1.0)), 1.0, uFullbright);

  vec3 sunTint = mix(vec3(0.58, 0.52, 0.56), vec3(1.02, 0.95, 0.90), lit);
  vec3 shaded = col * sunTint * clamp(0.36 + 0.78 * light * phase, 0.0, 1.4);
  shaded = mix(shaded, col, uFullbright);

  // lightning lights the cloud from within
  float flash = uFlash * exp(-distance(p, normalize(uFlashPos)) * 9.0);
  shaded += vec3(0.75, 0.82, 1.0) * flash;

  // a charging cell glows from within so storms stand out against the plain deck
  shaded += vec3(0.30, 0.34, 0.52) * smoothstep(0.35, 1.0, vCharge) * (0.35 + 0.5 * uHighlight);

  // Highlight does not switch the deck on and off -- clouds are part of the world and
  // are always there. It recolours them into a vivid key that separates the three
  // kinds at a glance: orange for raised dust, cyan for condensed ice, violet where
  // the cell has charged enough to thunder.
  // dust-vs-condensate and liquid-vs-frozen are INDEPENDENT axes. Multiplying them
  // together made an all-condensate cloud read as dust whenever it happened to be
  // above freezing, which is most of the time on this world.
  vec3 vivid = mix(vec3(1.00, 0.50, 0.10), vec3(0.22, 0.86, 1.00), iceShare);
  vivid = mix(vivid, vec3(0.62, 0.95, 1.00), iceShare * vIce * 0.6);
  vivid = mix(vivid, vec3(0.88, 0.30, 1.00), smoothstep(0.25, 0.85, vCharge));
  // the HG forward peak can exceed 1 on its own, and under fullbright everything is
  // lit at once, so this has to be clamped or the highlight blows out to paper
  vec3 lifted = vivid * clamp(0.55 + 0.40 * light * phase, 0.0, 1.0);
  lifted = mix(lifted, vivid, uFullbright);
  shaded = mix(shaded, lifted, uHighlight);
  float a = clamp(alpha * mix(0.75, 1.0, uHighlight), 0.0, 0.85);

  gl_FragColor = vec4(shaded, a);
}
`

export class CloudLayer {
  private world: World
  private mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial
  private cloudAttr: THREE.BufferAttribute
  private iceAttr: THREE.BufferAttribute
  private dustAttr: THREE.BufferAttribute
  private chargeAttr: THREE.BufferAttribute
  private smCloud: Float32Array
  private smDust: Float32Array
  private smCharge: Float32Array
  private smIce: Float32Array
  private smReady = false
  private time = 0
  private flash = 0
  private flashPos = new THREE.Vector3(1, 0, 0)

  visible = true

  constructor(parent: THREE.Object3D, world: World, radius: number) {
    this.world = world
    const { mesh } = world.sphere

    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(mesh.count * 3)
    for (let v = 0; v < mesh.count * 3; v++) pos[v] = mesh.pos[v]! * radius
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1))

    this.cloudAttr = new THREE.BufferAttribute(new Float32Array(mesh.count), 1)
    this.iceAttr = new THREE.BufferAttribute(new Float32Array(mesh.count), 1)
    this.dustAttr = new THREE.BufferAttribute(new Float32Array(mesh.count), 1)
    this.chargeAttr = new THREE.BufferAttribute(new Float32Array(mesh.count), 1)
    geo.setAttribute('aCloud', this.cloudAttr)
    geo.setAttribute('aIce', this.iceAttr)
    geo.setAttribute('aDust', this.dustAttr)
    geo.setAttribute('aCharge', this.chargeAttr)

    this.mat = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uEvolve: { value: new THREE.Vector3() },
        uDetail: { value: 0.55 },
        // Sized so opacity spans its useful range across the optical depths the
        // solver actually produces, instead of saturating on the first wisp.
        uExtinction: { value: 0.6 },
        uCoverage: { value: 0.6 },
        uFlash: { value: 0 },
        uFlashPos: { value: new THREE.Vector3(1, 0, 0) },
        uHighlight: { value: 1 },
        uFullbright: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide
    })

    const cells = world.sphere.grid.count
    this.smCloud = new Float32Array(cells)
    this.smDust = new Float32Array(cells)
    this.smCharge = new Float32Array(cells)
    this.smIce = new Float32Array(cells)

    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.renderOrder = 5
    parent.add(this.mesh)
  }

  setFullbright(v: number): void {
    this.mat.uniforms.uFullbright!.value = v
  }

  setRadius(r: number): void {
    const { mesh } = this.world.sphere
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let v = 0; v < mesh.count * 3; v++) arr[v] = mesh.pos[v]! * r
    attr.needsUpdate = true
  }

  /** Smooth over simulation ticks, not a second of wall time that averages away
   * entire days of formation/advection at high speed. */
  private ease(ticks: number): void {
    const c = this.world.clouds
    const n = this.smCloud.length
    const k = this.smReady ? -Math.expm1(-ticks / 2) : 1
    this.smReady = true
    const chargeScale = 1 / Math.max(1e-9, this.world.laws.breakdownField!)
    for (let i = 0; i < n; i++) {
      // Column totals: the deck is seen through, so material that has been lofted is
      // still in front of the observer. Drawing only the surface layer would make a
      // storm blink out at the moment it vented upward.
      // OPTICAL DEPTH, not an opacity. Saturating here and again through
      // Beer-Lambert in the shader compressed every load into the same flat sheet:
      // a wisp and a storm both came out at alpha 1. Passing tau through means the
      // drawn opacity tracks how much material is actually in the column.
      const cl = Math.min(MAX_OPTICAL_DEPTH, (c.cloud[i]! + c.cloudAloft[i]!) / CLOUD_OPTICAL_MASS)
      const du = Math.min(MAX_OPTICAL_DEPTH, (c.dust[i]! + c.dustAloft[i]!) / DUST_OPTICAL_MASS)
      this.smCloud[i] = this.smCloud[i]! + ((cl - this.smCloud[i]!) * k)
      this.smDust[i] = this.smDust[i]! + ((du - this.smDust[i]!) * k)
      this.smCharge[i] = this.smCharge[i]! + ((Math.min(1, c.charge[i]! * chargeScale) - this.smCharge[i]!) * k)
      this.smIce[i] = this.smIce[i]! + ((c.iceFrac[i]! - this.smIce[i]!) * k)
    }
  }

  /** Push the eased fields into the vertex attributes. */
  private writeAttributes(): void {
    const { mesh } = this.world.sphere
    // interpolated, not nearest-cell: nearest gives flat facets and the deck turns
    // into a sheet of hexagons
    interpolateToMesh(mesh, this.smCloud, this.cloudAttr.array as Float32Array)
    interpolateToMesh(mesh, this.smIce, this.iceAttr.array as Float32Array)
    interpolateToMesh(mesh, this.smDust, this.dustAttr.array as Float32Array)
    interpolateToMesh(mesh, this.smCharge, this.chargeAttr.array as Float32Array)
    this.cloudAttr.needsUpdate = true
    this.iceAttr.needsUpdate = true
    this.dustAttr.needsUpdate = true
    this.chargeAttr.needsUpdate = true
  }

  private lastWeatherTick = -1

  update(dtFrames: number, sun: [number, number, number]): void {
    // always drawn: the deck is part of the world, and `visible` only decides whether
    // it is emphasised
    this.mesh.visible = true
    this.mat.uniforms.uHighlight!.value = this.visible ? 1 : 0
    const tickChanged = this.lastWeatherTick !== this.world.tick
    const ticks = Math.max(0, this.world.tick - this.lastWeatherTick)
    const arrival = tickChanged && (dtFrames === 0 || this.lastWeatherTick < 0 || this.world.tick < this.lastWeatherTick)
    if (arrival) {
      this.smReady = false
    }
    this.time = this.world.tick
    if (tickChanged) {
      this.ease(ticks)
      this.writeAttributes()
    }
    // Closed Lissajous loop: continuous, bounded, and frozen whenever the tick is.
    const theta = (2 * Math.PI * this.time) / BILLOW_PERIOD_TICKS
    this.mat.uniforms.uEvolve!.value.set(
      BILLOW_RADIUS * Math.cos(theta),
      BILLOW_RADIUS * Math.sin(theta),
      BILLOW_RADIUS * 0.5 * Math.sin(2 * theta)
    )
    this.mat.uniforms.uSunDir!.value.set(sun[0], sun[1], sun[2])
    this.mat.uniforms.uCoverage!.value = this.world.laws.cloudCoverage!
    this.mat.uniforms.uDetail!.value = this.world.laws.cloudDetail!

    // a discharge lights its own cloud from inside for a few frames
    const flashes = this.world.clouds.flashes
    if (flashes.length && tickChanged) {
      const cell = flashes[Math.floor(Math.random() * flashes.length)]!
      const g = this.world.sphere.grid
      this.flashPos.set(g.pos[cell * 3]!, g.pos[cell * 3 + 1]!, g.pos[cell * 3 + 2]!)
      this.flash = 1
    }
    this.flash = Math.max(0, this.flash - 0.12 * dtFrames)
    this.mat.uniforms.uFlash!.value = this.flash
    this.mat.uniforms.uFlashPos!.value.copy(this.flashPos)
    this.lastWeatherTick = this.world.tick
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}
