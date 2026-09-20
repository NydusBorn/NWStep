import * as THREE from 'three'
import type { World } from '../sim/world'
import { interpolateToMesh } from '../sim/icosphere'

/** The shell displays transported mass. Sub-grid detail uses two renewing flow
 * maps: each travels with local wind for a bounded interval, and renews only at
 * zero weight. Coordinates never accumulate shear over the lifetime of the app.
 * These are visual details, not extra sources of simulated cloud/dust mass. */
const CLOUD_OPTICAL_MASS = 0.00005
const DUST_OPTICAL_MASS = 3

const cloudVert = /* glsl */`
attribute float aCloud;
attribute float aIce;
attribute float aDust;
attribute float aCharge;
attribute vec3 aFlow;
varying float vCloud;
varying float vIce;
varying float vDust;
varying float vCharge;
varying vec3 vObj;
varying vec3 vView;
varying vec3 vFlow;

void main() {
  vCloud = aCloud;
  vIce = aIce;
  vDust = aDust;
  vCharge = aCharge;
  vFlow = aFlow;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const cloudFrag = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform float uTime;
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
varying vec3 vFlow;

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

float flowNoise(vec3 p, float clock) {
  float age = mod(clock, 16.0);
  float generation = floor(clock / 16.0);
  // A new domain enters at zero weight. It does not snap the visible pattern
  // back to the same fixed surface texture every cycle.
  vec3 origin = vec3(7.13, 3.71, 11.17) * mod(generation, 4096.0);
  vec3 departure = normalize(p - vFlow * age);
  return fbm(departure * (24.0 * uDetail) + origin);
}

float density(vec3 p, float base) {
  if (base <= 0.002) return 0.0;
  float weight = 1.0 - abs(mod(uTime, 16.0) / 8.0 - 1.0);
  float n = mix(flowNoise(p, uTime + 8.0), flowNoise(p, uTime), weight);
  float cut = 0.64 - 0.28 * uCoverage + 0.12 * (1.0 - base);
  return base * smoothstep(cut, cut + 0.22, n);
}

// Henyey-Greenstein: the forward peak is what makes a cloud edge glow toward the star
float hg(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566370614 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}

void main() {
  vec3 p = normalize(vObj);
  float base = min(1.0, vCloud + vDust * 0.75);
  float d = density(p, base);
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
  float iceShare = vCloud / max(1e-4, vCloud + vDust);
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
  private flowAttr: THREE.BufferAttribute
  private flow: Float32Array
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
    this.flowAttr = new THREE.BufferAttribute(new Float32Array(mesh.count * 3), 3)
    this.flow = new Float32Array(world.sphere.grid.count * 3)
    geo.setAttribute('aCloud', this.cloudAttr)
    geo.setAttribute('aIce', this.iceAttr)
    geo.setAttribute('aDust', this.dustAttr)
    geo.setAttribute('aCharge', this.chargeAttr)
    geo.setAttribute('aFlow', this.flowAttr)

    this.mat = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uTime: { value: 0 },
        uDetail: { value: 0.55 },
        uExtinction: { value: 2.2 },
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
      const cl = -Math.expm1(-c.cloud[i]! / CLOUD_OPTICAL_MASS)
      const du = -Math.expm1(-c.dust[i]! / DUST_OPTICAL_MASS)
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
    const flow = this.flowAttr.array as Float32Array
    for (let v = 0; v < mesh.count; v++) {
      for (let axis = 0; axis < 3; axis++) {
        flow[v * 3 + axis] = v < mesh.simCount
          ? this.flow[v * 3 + axis]!
          : (flow[mesh.parentA[v]! * 3 + axis]! + flow[mesh.parentB[v]! * 3 + axis]!) * 0.5
      }
    }
    this.flowAttr.needsUpdate = true
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
      const { grid } = this.world.sphere
      const { air } = this.world
      for (let i = 0; i < grid.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const j = i * 3 + axis
          const velocity = grid.east[j]! * air.windU[i]! + grid.north[j]! * air.windV[i]!
          this.flow[j] = velocity
        }
      }
    }
    if (tickChanged) {
      this.ease(ticks)
      this.writeAttributes()
    }
    this.mat.uniforms.uTime!.value = this.time
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
