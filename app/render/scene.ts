import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { World } from '../sim/world'
import { refreshFigureOffsets } from '../sim/world'
import { sunDirection } from '../sim/air'
import { planetRadiusKm, corotate } from '../sim/units'
import { interpolateToMesh } from '../sim/icosphere'
import { WindLayer } from './windLayer'
import { CloudLayer } from './cloudLayer'
import { ColonyLayer } from './colonyLayer'
import { colonyRadius } from '../sim/life'
import { LightningLayer } from './lightningLayer'

export type FieldMode = 'elevation' | 'temperature' | 'wind' | 'pressure'

const MODE_ID: Record<FieldMode, number> = {
  elevation: 0, temperature: 1, wind: 2, pressure: 3
}

const STAR_DISTANCE = 70
/** How often to refill the per-cell figure offsets used by the probe. Milliseconds,
 *  not frames: counting frames made the probe refresh at 4 Hz on a 60 Hz panel but
 *  only 2 Hz in a 32 Hz Remote Desktop session, for no reason the reader could see. */
const FIGURE_READOUT_MS = 250

const planetVert = /* glsl */`
attribute float aValue;
varying float vValue;
varying vec3 vNormalObj;
void main() {
  vValue = aValue;
  vNormalObj = normalize(normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const planetFrag = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform int uMode;
uniform float uAmbient;
uniform float uFullbright;
varying float vValue;
varying vec3 vNormalObj;

// A barren, oxidised, rocky surface. No water, no vegetation: dark basaltic
// lowlands, iron-oxide plains, dust-mantled uplands, pale exposed silicate peaks.
vec3 rampRegolith(float t) {
  vec3 c0 = vec3(0.10, 0.075, 0.070);
  vec3 c1 = vec3(0.26, 0.135, 0.095);
  vec3 c2 = vec3(0.44, 0.245, 0.145);
  vec3 c3 = vec3(0.61, 0.415, 0.260);
  vec3 c4 = vec3(0.76, 0.655, 0.520);
  vec3 c5 = vec3(0.86, 0.845, 0.810);
  if (t < 0.22) return mix(c0, c1, t / 0.22);
  if (t < 0.45) return mix(c1, c2, (t - 0.22) / 0.23);
  if (t < 0.66) return mix(c2, c3, (t - 0.45) / 0.21);
  if (t < 0.85) return mix(c3, c4, (t - 0.66) / 0.19);
  return mix(c4, c5, (t - 0.85) / 0.15);
}

vec3 rampThermal(float t) {
  vec3 a = vec3(0.10,0.15,0.45);
  vec3 b = vec3(0.15,0.65,0.75);
  vec3 c = vec3(0.95,0.85,0.35);
  vec3 d = vec3(0.85,0.18,0.10);
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}

vec3 rampWind(float t) {
  vec3 a = vec3(0.04,0.03,0.06);
  vec3 b = vec3(0.10,0.45,0.60);
  vec3 c = vec3(0.55,0.92,0.95);
  vec3 d = vec3(1.00,1.00,1.00);
  if (t < 0.4) return mix(a, b, t / 0.4);
  if (t < 0.75) return mix(b, c, (t - 0.4) / 0.35);
  return mix(c, d, (t - 0.75) / 0.25);
}

vec3 rampPressure(float t) {
  vec3 a = vec3(0.30,0.06,0.34);
  vec3 b = vec3(0.12,0.28,0.32);
  vec3 c = vec3(0.88,0.86,0.58);
  if (t < 0.5) return mix(a, b, t / 0.5);
  return mix(b, c, (t - 0.5) / 0.5);
}

void main() {
  float t = clamp(vValue, 0.0, 1.0);
  vec3 base;
  if (uMode == 0) base = rampRegolith(t);
  else if (uMode == 1) base = rampThermal(t);
  else if (uMode == 2) base = rampWind(t);
  else base = rampPressure(t);

  vec3 n = normalize(vNormalObj);
  float lit = max(0.0, dot(n, normalize(uSunDir)));
  lit = pow(lit, 0.85);
  // fullbright ignores the star entirely: every face lit the same, for looking at the
  // whole planet at once instead of half of it
  lit = mix(lit, 1.0, uFullbright);
  // a dim red-dwarf night, warmed slightly on the lit side
  vec3 night = base * vec3(0.55, 0.50, 0.62);
  vec3 day = base * vec3(1.06, 0.97, 0.88);
  gl_FragColor = vec4(mix(night * uAmbient / 0.22, day, lit) , 1.0);
}
`

const atmoVert = /* glsl */`
varying vec3 vNormalObj;
void main() {
  vNormalObj = normalize(normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const atmoFrag = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform float uFullbright;
varying vec3 vNormalObj;
void main() {
  float lit = max(0.0, dot(normalize(vNormalObj), normalize(uSunDir)));
  lit = mix(lit, 1.0, uFullbright);
  vec3 c = mix(vec3(0.24,0.16,0.14), vec3(0.78,0.52,0.34), lit * 0.75);
  gl_FragColor = vec4(c, 0.20 * (0.18 + 0.82 * lit));
}
`

export class PlanetScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls

  private world: World
  private planet!: THREE.Mesh
  private planetGeo!: THREE.BufferGeometry
  private planetMat!: THREE.ShaderMaterial
  private atmoMat!: THREE.ShaderMaterial
  private atmo!: THREE.Mesh
  private valueAttr!: THREE.BufferAttribute

  private moonMeshes: THREE.Mesh[] = []
  private moonTrails: THREE.Line[] = []
  private starMesh!: THREE.Mesh
  private sunLight!: THREE.DirectionalLight

  private wind!: WindLayer
  private clouds!: CloudLayer
  private colonies!: ColonyLayer
  private lightning!: LightningLayer
  showLife = true
  showCreatures = true
  selectedColony: number | null = null
  private marker!: THREE.Group
  private windArrow!: THREE.Line

  /** Everything belonging to the planet's body. The hydrostatic figure is applied to
   *  this group as a stretch, so terrain, air and marker all deform together. */
  private figureGroup = new THREE.Group()
  private figureMatrix = new THREE.Matrix4()
  private invPlanet = new THREE.Matrix4()
  private markerLocal = new THREE.Matrix4()

  private fieldScratch: Float32Array | null = null
  /** Starts due, so the first render fills the offsets before anything reads them. */
  private figureAcc = FIGURE_READOUT_MS
  private maxRadius = 1

  /** Fraction of the native framebuffer. An RDP session is usually fill-rate bound
   *  (frequently on a software GL driver), so drawing fewer pixels is the setting
   *  that actually buys frames there, where a frame-rate ceiling cannot. */
  renderScale = 1
  private cssWidth = 1
  private cssHeight = 1

  mode: FieldMode = 'elevation'
  exaggeration = 5
  figureExaggeration = 2
  showWind = true
  showClouds = true
  fullbright = false
  private rand: () => number

  constructor(canvas: HTMLCanvasElement, world: World, rand: () => number) {
    this.world = world
    this.rand = rand

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.applyPixelRatio()
    this.scene.background = new THREE.Color(0x05060a)

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 4000)
    this.camera.position.set(0, 1.35, 3.1)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 1.3
    this.controls.maxDistance = 40
    this.controls.target.set(0, 0, 0)

    this.figureGroup.matrixAutoUpdate = false
    this.scene.add(this.figureGroup)

    this.buildPlanet()
    this.buildAtmosphere()
    this.buildStarfield()
    this.buildBodies()
    this.wind = new WindLayer(this.figureGroup, world)
    this.clouds = new CloudLayer(this.figureGroup, world, 1.09)
    this.colonies = new ColonyLayer(this.figureGroup, world)
    this.lightning = new LightningLayer(this.figureGroup, world)
    this.buildMarker()
    this.applyFigure()

    this.sunLight = new THREE.DirectionalLight(0xffc9a0, 2.2)
    this.scene.add(this.sunLight)
    this.scene.add(new THREE.AmbientLight(0x3a3040, 0.6))
  }

  // ---------------------------------------------------------------- construction

  private buildPlanet(): void {
    const { mesh } = this.world.sphere
    this.planetGeo = new THREE.BufferGeometry()
    this.planetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.count * 3), 3))
    this.planetGeo.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    this.valueAttr = new THREE.BufferAttribute(new Float32Array(mesh.count), 1)
    this.planetGeo.setAttribute('aValue', this.valueAttr)

    this.planetMat = new THREE.ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: planetFrag,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uMode: { value: 0 },
        uAmbient: { value: 0.22 },
        uFullbright: { value: 0 }
      }
    })

    this.planet = new THREE.Mesh(this.planetGeo, this.planetMat)
    this.figureGroup.add(this.planet)
    this.rebuildTerrainGeometry()
  }

  /**
   * Displace the mesh by terrain relief only. The hydrostatic figure is NOT baked in
   * here: it tracks the moon, and rebuilding 40k vertices to follow it made the planet
   * jitter in discrete steps instead of flexing. It is applied as a matrix instead.
   */
  rebuildTerrainGeometry(): void {
    const { mesh } = this.world.sphere
    const elev = this.world.terrain.elev
    const pos = this.planetGeo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const k = this.exaggeration / planetRadiusKm(this.world.laws)
    let maxR = 0
    let sumR = 0
    for (let v = 0; v < mesh.count; v++) {
      const r = 1 + elev[v]! * k
      sumR += r
      if (r > maxR) maxR = r
      arr[v * 3] = mesh.pos[v * 3]! * r
      arr[v * 3 + 1] = mesh.pos[v * 3 + 1]! * r
      arr[v * 3 + 2] = mesh.pos[v * 3 + 2]! * r
    }
    pos.needsUpdate = true
    this.planetGeo.computeVertexNormals()
    this.planetGeo.computeBoundingSphere()

    // Wind follows a local terrain envelope, including narrow render-mesh peaks.
    this.maxRadius = maxR
    const meanR = sumR / mesh.count
    if (this.wind) this.wind.setTerrain(this.exaggeration)
    // above the HIGHEST ground, not the mean: at mean radius the 45 km peaks push
    // straight through the deck and the clouds read as painted on the surface
    if (this.clouds) this.clouds.setRadius(maxR + 0.035)
    if (this.atmo) this.atmo.scale.setScalar(Math.max(maxR + 0.01, meanR + 0.035))
  }

  private buildAtmosphere(): void {
    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uFullbright: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    })
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.atmoMat)
    this.atmo.scale.setScalar(this.maxRadius + 0.05)
    this.atmo.renderOrder = 4
    this.figureGroup.add(this.atmo)
  }

  private buildStarfield(): void {
    const n = 2400
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const z = this.rand() * 2 - 1
      const a = this.rand() * Math.PI * 2
      const r = Math.sqrt(1 - z * z) * 900
      p[i * 3] = r * Math.cos(a)
      p[i * 3 + 1] = z * 900
      p[i * 3 + 2] = r * Math.sin(a)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fb0d0, size: 1.5, sizeAttenuation: false
    })))
  }

  private buildBodies(): void {
    for (const b of this.world.bodies) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(b.radius, 32, 16),
        new THREE.MeshLambertMaterial({ color: b.color })
      )
      this.scene.add(m)
      this.moonMeshes.push(m)

      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(260 * 3), 3))
      g.setDrawRange(0, 0)
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: b.color, transparent: true, opacity: 0.18
      }))
      this.scene.add(line)
      this.moonTrails.push(line)
    }

    this.starMesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6a30 })
    )
    this.scene.add(this.starMesh)
    this.starMesh.add(new THREE.Mesh(
      new THREE.SphereGeometry(6.5, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff4a18, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    ))
  }

  private buildMarker(): void {
    this.marker = new THREE.Group()
    this.marker.add(new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.006, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x5cf2c0 })
    ))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.windArrow = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe066 }))
    this.marker.add(this.windArrow)
    this.marker.visible = false
    this.figureGroup.add(this.marker)
  }

  // --------------------------------------------------------------------- update

  /** Recompute the per-vertex display value for the current field mode. */
  refreshField(): void {
    const { grid, mesh } = this.world.sphere
    const { air, terrain } = this.world
    if (!this.fieldScratch || this.fieldScratch.length !== grid.count) {
      this.fieldScratch = new Float32Array(grid.count)
    }
    const src = this.fieldScratch

    if (this.mode === 'elevation') {
      for (let i = 0; i < grid.count; i++) src[i] = terrain.elevSim[i]!
    } else if (this.mode === 'temperature') {
      const lapse = this.world.laws.lapseRate!
      for (let i = 0; i < grid.count; i++) {
        const h = terrain.elevSim[i]!
        src[i] = air.temp[i]! - lapse * (h > 0 ? h : 0)
      }
    } else if (this.mode === 'wind') {
      for (let i = 0; i < grid.count; i++) src[i] = air.speed[i]!
    } else {
      for (let i = 0; i < grid.count; i++) src[i] = air.press[i]!
    }

    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < grid.count; i++) {
      const v = src[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (this.mode === 'elevation') {
      const span = Math.max(Math.abs(lo), Math.abs(hi), 1e-3)
      lo = -span; hi = span
    }
    const range = hi - lo || 1

    for (let i = 0; i < grid.count; i++) src[i] = (src[i]! - lo) / range
    interpolateToMesh(mesh, src, this.valueAttr.array as Float32Array)
    this.valueAttr.needsUpdate = true
    this.planetMat.uniforms.uMode!.value = MODE_ID[this.mode]
  }

  /** Display the solid body's evolved strain, never the instantaneous tide.
   * The symmetric tensor adds rotation and all tides without tilting the spin axis. */
  private applyFigure(): void {
    const s = this.world.strain
    const k = this.figureExaggeration
    this.figureMatrix.set(
      1 + s[0]! * k, s[3]! * k, s[4]! * k, 0,
      s[3]! * k, 1 + s[1]! * k, s[5]! * k, 0,
      s[4]! * k, s[5]! * k, 1 + s[2]! * k, 0,
      0, 0, 0, 1
    )
    this.figureGroup.matrix.copy(this.figureMatrix)
    this.figureGroup.matrixWorldNeedsUpdate = true
  }

  /**
   * Moons are drawn in the planet's co-rotating frame, the same frame the camera and
   * the star already use. Each trail sample is rotated by the clock it was recorded
   * at, so at tidal lock the trail collapses to a point -- which is the honest picture:
   * the moon really does hang over one spot, and that is why the bulge stops moving.
   */
  private updateBodies(): void {
    const { bodies, tick, laws } = this.world
    for (let i = 0; i < bodies.length && i < this.moonMeshes.length; i++) {
      const b = bodies[i]!
      const p = corotate(b.pos[0], b.pos[1], b.pos[2], tick, laws)
      this.moonMeshes[i]!.position.set(p[0], p[1], p[2])

      const line = this.moonTrails[i]!
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const samples = Math.min(b.trail.length / 4, arr.length / 3) | 0
      const base = b.trail.length - samples * 4
      for (let k = 0; k < samples; k++) {
        const o = base + k * 4
        const q = corotate(b.trail[o]!, b.trail[o + 1]!, b.trail[o + 2]!, b.trail[o + 3]!, laws)
        arr[k * 3] = q[0]
        arr[k * 3 + 1] = q[1]
        arr[k * 3 + 2] = q[2]
      }
      attr.needsUpdate = true
      line.geometry.setDrawRange(0, samples)
    }
  }

  /** Place the inspector marker on a cell and point the arrow downwind. */
  setMarker(cell: number | null): void {
    if (cell === null) { this.marker.visible = false; return }
    const { grid } = this.world.sphere
    const r = 1 + (this.world.terrain.elevSim[cell]! * this.exaggeration) / planetRadiusKm(this.world.laws) + 0.004
    const px = grid.pos[cell * 3]!, py = grid.pos[cell * 3 + 1]!, pz = grid.pos[cell * 3 + 2]!
    this.marker.position.set(px * r, py * r, pz * r)
    this.marker.lookAt(0, 0, 0)
    this.marker.visible = true

    const u = this.world.air.windU[cell]!, v = this.world.air.windV[cell]!
    const m = Math.hypot(u, v) || 1e-9
    const scale = 0.16 * Math.min(1, m / Math.max(1e-9, this.world.air.maxSpeed) + 0.25)
    const dir = new THREE.Vector3(
      grid.east[cell * 3]! * u + grid.north[cell * 3]! * v,
      grid.east[cell * 3 + 1]! * u + grid.north[cell * 3 + 1]! * v,
      grid.east[cell * 3 + 2]! * u + grid.north[cell * 3 + 2]! * v
    ).normalize().multiplyScalar(scale)
    // both points live in the group's undeformed space, so invert only the marker's
    // own local transform -- worldToLocal would drag the figure stretch in with it
    const target = new THREE.Vector3(px * r, py * r, pz * r).add(dir)
    this.markerLocal
      .compose(this.marker.position, this.marker.quaternion, this.marker.scale)
      .invert()
    const local = target.applyMatrix4(this.markerLocal)
    const attr = this.windArrow.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    arr[0] = 0; arr[1] = 0; arr[2] = 0
    arr[3] = local.x; arr[4] = local.y; arr[5] = local.z
    attr.needsUpdate = true
  }

  /** Raycast a normalised device coordinate onto the planet; returns a sim cell. */
  pickColony(ndcX: number, ndcY: number): number | null {
    if (!this.showLife) return null
    this.scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const localRay = ray.ray.clone().applyMatrix4(this.figureGroup.matrixWorld.clone().invert())
    const hit = localRay.intersectSphere(new THREE.Sphere(new THREE.Vector3(), this.maxRadius + 0.045), new THREE.Vector3())
    if (!hit) return null
    const worldHit = hit.clone().applyMatrix4(this.figureGroup.matrixWorld)
    const terrainHit = ray.intersectObject(this.planet, false)[0]
    if (terrainHit && terrainHit.distance < ray.ray.origin.distanceTo(worldHit) - 0.001) return null
    hit.normalize()
    let best: number | null = null, bestDistance = Infinity
    for (const c of this.world.life.colonies) {
      const distance = hit.distanceTo(new THREE.Vector3(...c.position))
      if (distance <= colonyRadius(c) * 1.12 && distance < bestDistance) {
        best = c.id; bestDistance = distance
      }
    }
    return best
  }

  focusColony(id: number): void {
    const colony = this.world.life.colonies.find(c => c.id === id)
    if (!colony) return
    this.scene.updateMatrixWorld(true)
    const centre = new THREE.Vector3().applyMatrix4(this.figureGroup.matrixWorld)
    const direction = new THREE.Vector3(...colony.position).transformDirection(this.figureGroup.matrixWorld)
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target), this.maxRadius * 1.5)
    this.controls.target.copy(centre)
    this.camera.position.copy(centre).addScaledVector(direction, distance)
    this.camera.lookAt(centre)
    this.controls.update()
  }

  pick(ndcX: number, ndcY: number): number | null {
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = ray.intersectObject(this.planet, false)
    if (!hits.length) return null
    const hit = hits[0]!
    const face = hit.face
    if (!face) return null
    const { mesh } = this.world.sphere
    // undo the figure stretch before comparing against the unit-sphere cell table
    this.invPlanet.copy(this.planet.matrixWorld).invert()
    const p = hit.point.clone().applyMatrix4(this.invPlanet).normalize()
    let best = face.a, bestD = Infinity
    for (const v of [face.a, face.b, face.c]) {
      const d = (mesh.pos[v * 3]! - p.x) ** 2
        + (mesh.pos[v * 3 + 1]! - p.y) ** 2
        + (mesh.pos[v * 3 + 2]! - p.z) ** 2
      if (d < bestD) { bestD = d; best = v }
    }
    return mesh.owner[best]!
  }

  resize(w: number, h: number): void {
    this.cssWidth = w
    this.cssHeight = h
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.wind.setResolution(w, h)
  }

  /** Resize the framebuffer without touching the CSS box, so the picture stays the
   *  same size on screen while costing more or fewer pixels per frame. */
  setRenderScale(scale: number): void {
    const next = Number.isFinite(scale) ? Math.min(1, Math.max(0.25, scale)) : 1
    if (next === this.renderScale) return
    this.renderScale = next
    this.applyPixelRatio()
    // setPixelRatio only takes effect on the next setSize, so re-apply the current box.
    this.resize(this.cssWidth, this.cssHeight)
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * this.renderScale)
  }

  get windStreamCount(): number {
    return this.wind.activeStreams
  }

  /**
   * @param dtMs wall-clock milliseconds since the previous rendered frame.
   */
  render(dtMs: number, animateWeather = true): void {
    // The one place wall-clock time becomes animation units. Clamped so a stall does
    // not teleport the weather and a very fast display does not inch it forward; the
    // layers below step by this, so they run at the same pace on any display. The
    // finite check is not paranoia: the layers decay state by dtFrames, and NaN there
    // is sticky (`Math.max(0, NaN)` is NaN), so one bad frame would black out the
    // clouds until the scene is rebuilt rather than until the next good frame.
    const dtFrames = Number.isFinite(dtMs) ? Math.min(3, Math.max(0.2, dtMs / 16.667)) : 1
    const [sx, sy, sz] = sunDirection(this.world.tick, this.world.laws)
    this.planetMat.uniforms.uSunDir!.value.set(sx, sy, sz)
    this.atmoMat.uniforms.uSunDir!.value.set(sx, sy, sz)
    this.sunLight.position.set(sx * 10, sy * 10, sz * 10)
    const starDistance = STAR_DISTANCE * this.world.laws.starDistance!
    this.starMesh.position.set(sx * starDistance, sy * starDistance, sz * starDistance)

    // Apply the slowly evolved solid figure without rebuilding terrain geometry.
    this.applyFigure()
    this.figureAcc += dtMs
    if (this.figureAcc >= FIGURE_READOUT_MS) {
      this.figureAcc = 0
      refreshFigureOffsets(this.world)
    }

    const fb = this.fullbright ? 1 : 0
    this.planetMat.uniforms.uFullbright!.value = fb
    this.atmoMat.uniforms.uFullbright!.value = fb
    this.clouds.setFullbright(fb)
    this.updateBodies()
    this.wind.visible = this.showWind
    this.controls.update()
    this.wind.update(dtFrames, animateWeather, this.camera.position.distanceTo(this.controls.target) / this.maxRadius, this.camera)
    this.clouds.visible = this.showClouds
    this.clouds.update(animateWeather ? dtFrames : 0, [sx, sy, sz])
    this.colonies.update(this.maxRadius + 0.045, this.showLife, this.selectedColony, this.showCreatures)
    this.lightning.update(this.maxRadius + 0.048)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.clouds.dispose()
    this.colonies.dispose()
    this.lightning.dispose()
    this.wind.dispose()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
