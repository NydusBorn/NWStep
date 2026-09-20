import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { World } from '../sim/world'
import { PLANET_RADIUS_KM } from '../sim/units'

/** Persistent short streamlines. Seeds and arrow identities never change when
 * neighbouring lines cross. Arrow tips interpolate continuously along each line;
 * binary per-segment dash masks used to make them jump a whole segment at once. */
const ANCHORS = 642
const COARSE_ANCHORS = 42
const MEDIUM_ANCHORS = 162
const HALF_STEPS = 32
const POINTS = HALF_STEPS * 2 + 1
const SEGMENTS = ANCHORS * (POINTS - 1 + 2 * 5)
const RAMP = [
  [0, 0.10, 0.14, 0.34], [0.3, 0.10, 0.62, 0.82],
  [0.55, 0.58, 0.95, 0.86], [0.78, 1, 0.76, 0.32], [1, 1, 0.93, 0.88]
]

/** Display smoothing time constant for the traced field, in simulation ticks. Small
 *  enough that the picture is never more than a fraction of a day behind the solver,
 *  which is what keeps the pause transition imperceptible. */
const FIELD_TAU_TICKS = 6
/** While paused the weather is fixed, so the display converges on it over this many
 *  frames. Wall-clock, because no simulated time is passing to measure it in. */
const PAUSE_SETTLE_FRAMES = 10

export class WindLayer {
  private geo = new LineSegmentsGeometry()
  private mat = new LineMaterial({ linewidth: 1.4, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false })

  private obj: LineSegments2
  private pos = new Float32Array(SEGMENTS * 6)
  private col = new Float32Array(SEGMENTS * 6)
  private widths = new Float32Array(SEGMENTS)
  private widthAttr = new THREE.InstancedBufferAttribute(this.widths, 1)
  private merged = new Map<string, number>()
  private mergeCounts = new Float32Array(SEGMENTS)
  private segmentLine = new Int32Array(SEGMENTS)
  private lineEnds = new Int32Array(ANCHORS)
  private currentLine = 0
  private joined = false
  private anchors = new Float32Array(ANCHORS * 3)
  private cells = new Int32Array(ANCHORS)
  private parents = new Int32Array(ANCHORS)
  private field: Float32Array
  private broadField: Float32Array
  private spatialScratch: Float32Array
  private terrainR: Float32Array
  private orderedNbr: Int32Array
  private nbrAngles: Float64Array
  private sampledRadius = 1
  private points = new Float32Array(POINTS * 3)
  private phases = new Float64Array(ANCHORS)
  private ready = false
  private lastTick = -1
  private maxSpeed = 1e-9
  private count = 0
  private detail = 0
  private flow = new THREE.Vector3()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private c = new THREE.Vector3()
  private tip = new THREE.Vector3()
  private dir = new THREE.Vector3()
  private side = new THREE.Vector3()
  private midpoint = new THREE.Vector3()
  private previousDir = new THREE.Vector3()
  private rgb = new THREE.Color()
  private viewFrustum = new THREE.Frustum()
  private viewMatrix = new THREE.Matrix4()
  private bounds = new THREE.Sphere()
  private minTerrainRadius = 1.003
  private maxTerrainRadius = 1.003
  private opaqueRadius = 1
  private localCamera = new THREE.Vector3()
  private inverseWorld = new THREE.Matrix4()

  radius = 1.05
  visible = true
  activeStreams = 0

  constructor(parent: THREE.Object3D, private world: World) {
    const g = world.sphere.grid
    this.field = new Float32Array(g.count * 3)
    this.broadField = new Float32Array(g.count * 3)
    this.spatialScratch = new Float32Array(g.count * 3)
    this.terrainR = new Float32Array(g.count).fill(1.003)
    this.orderedNbr = new Int32Array(g.nbrList.length)
    this.nbrAngles = new Float64Array(g.nbrList.length)
    for (let i = 0; i < g.count; i++) {
      const edges = Array.from({ length: g.nbrStart[i + 1]! - g.nbrStart[i]! }, (_, j) => g.nbrStart[i]! + j)
      edges.sort((a, b) => Math.atan2(g.nbrV[a]!, g.nbrU[a]!) - Math.atan2(g.nbrV[b]!, g.nbrU[b]!))
      for (let j = 0; j < edges.length; j++) {
        this.orderedNbr[g.nbrStart[i]! + j] = g.nbrList[edges[j]!]!
        this.nbrAngles[g.nbrStart[i]! + j] = Math.atan2(g.nbrV[edges[j]!]!, g.nbrU[edges[j]!]!)
      }
    }
    this.geo.setPositions(this.pos)
    this.geo.setColors(this.col)
    this.geo.setAttribute('instanceWidth', this.widthAttr)
    this.mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float linewidth;', 'uniform float linewidth;\nattribute float instanceWidth;')
        .replace('offset *= linewidth;', 'offset *= linewidth * instanceWidth;')
    }
    this.obj = new LineSegments2(this.geo, this.mat)
    this.obj.frustumCulled = false
    this.obj.renderOrder = 3
    parent.add(this.obj)
    // Nested icosphere vertices: 42 / 162 / 642 seeds, bounded at both ends.
    // Each finer seed separates smoothly from its nearest coarse parent.
    for (let i = 0; i < ANCHORS; i++) {
      const x = g.pos[i * 3]!, y = g.pos[i * 3 + 1]!, z = g.pos[i * 3 + 2]!
      this.anchors.set([x, y, z], i * 3)
      this.cells[i] = i
      let best = -Infinity
      const parentCount = i < MEDIUM_ANCHORS ? COARSE_ANCHORS : MEDIUM_ANCHORS
      for (let j = 0; j < parentCount; j++) {
        const dot = x * g.pos[j * 3]! + y * g.pos[j * 3 + 1]! + z * g.pos[j * 3 + 2]!
        if (dot > best) { best = dot; this.parents[i] = j }
      }
      this.phases[i] = (i * 0.61803398875) % 1
    }
  }

  setResolution(w: number, h: number): void {
    this.mat.resolution.set(w, h)
  }

  /** Conservative local envelopes of the full-resolution terrain. Neighbour
   * padding covers narrow peaks between weather cells; interpolation keeps the
   * wind surface smooth instead of stepping up/down at cell boundaries. */
  setTerrain(exaggeration: number): void {
    const { grid: g, mesh } = this.world.sphere
    const local = new Float32Array(g.count).fill(-Infinity)
    this.opaqueRadius = Infinity
    for (let v = 0; v < mesh.count; v++) {
      const i = mesh.owner[v]!
      const r = 1 + this.world.terrain.elev[v]! * exaggeration / PLANET_RADIUS_KM
      local[i] = Math.max(local[i]!, r)
      this.opaqueRadius = Math.min(this.opaqueRadius, r)
    }
    this.terrainR.set(local)
    for (let pass = 0; pass < 2; pass++) {
      local.set(this.terrainR)
      for (let i = 0; i < g.count; i++) {
        let r = local[i]!
        for (let k = g.nbrStart[i]!; k < g.nbrStart[i + 1]!; k++) r = Math.max(r, local[g.nbrList[k]!]!)
        this.terrainR[i] = r
      }
    }
    for (let i = 0; i < g.count; i++) this.terrainR[i] = this.terrainR[i]! + 0.003
    this.minTerrainRadius = Math.min(...this.terrainR)
    this.maxTerrainRadius = Math.max(...this.terrainR)
  }

  /** Walk to the nearest cell, then interpolate Cartesian velocity across its
   * neighbours. Nearest-cell directions alone jump at cell boundaries. */
  private sample(p: THREE.Vector3, startCell: number): number {
    const g = this.world.sphere.grid
    let cell = startCell
    for (let iter = 0; iter < 4; iter++) {
      let best = cell
      let dot = p.x * g.pos[cell * 3]! + p.y * g.pos[cell * 3 + 1]! + p.z * g.pos[cell * 3 + 2]!
      for (let k = g.nbrStart[cell]!; k < g.nbrStart[cell + 1]!; k++) {
        const j = g.nbrList[k]!
        const d = p.x * g.pos[j * 3]! + p.y * g.pos[j * 3 + 1]! + p.z * g.pos[j * 3 + 2]!
        if (d > dot) { dot = d; best = j }
      }
      if (best === cell) break
      cell = best
    }
    this.flow.set(0, 0, 0)
    this.sampledRadius = 0
    // Barycentric interpolation on the containing grid triangle is continuous
    // at edges. An inverse-distance neighbour set jumps when its centre changes.
    const start = g.nbrStart[cell]!, end = g.nbrStart[cell + 1]!
    const angle = Math.atan2(p.x * g.north[cell * 3]! + p.y * g.north[cell * 3 + 1]! + p.z * g.north[cell * 3 + 2]!,
      p.x * g.east[cell * 3]! + p.y * g.east[cell * 3 + 1]! + p.z * g.east[cell * 3 + 2]!)
    let sector = end - 1
    for (let k = start; k < end - 1; k++) {
      if (angle >= this.nbrAngles[k]! && angle < this.nbrAngles[k + 1]!) { sector = k; break }
    }
    const b = this.orderedNbr[sector]!, c = this.orderedNbr[sector + 1 < end ? sector + 1 : start]!
    const ax = g.pos[cell * 3]!, ay = g.pos[cell * 3 + 1]!, az = g.pos[cell * 3 + 2]!
    const bx = g.pos[b * 3]!, by = g.pos[b * 3 + 1]!, bz = g.pos[b * 3 + 2]!
    const cx = g.pos[c * 3]!, cy = g.pos[c * 3 + 1]!, cz = g.pos[c * 3 + 2]!
    const wa = p.x * (by * cz - bz * cy) + p.y * (bz * cx - bx * cz) + p.z * (bx * cy - by * cx)
    const wb = p.x * (cy * az - cz * ay) + p.y * (cz * ax - cx * az) + p.z * (cx * ay - cy * ax)
    const wc = p.x * (ay * bz - az * by) + p.y * (az * bx - ax * bz) + p.z * (ax * by - ay * bx)
    const denominator = wa + wb + wc
    let total = 0
    for (let corner = 0; corner < 3; corner++) {
      const j = corner === 0 ? cell : corner === 1 ? b : c
      const weight = Math.max(0, (corner === 0 ? wa : corner === 1 ? wb : wc) / denominator)
      const d = this.detail
      this.flow.x += (this.field[j * 3]! * d + this.broadField[j * 3]! * (1 - d)) * weight
      this.flow.y += (this.field[j * 3 + 1]! * d + this.broadField[j * 3 + 1]! * (1 - d)) * weight
      this.flow.z += (this.field[j * 3 + 2]! * d + this.broadField[j * 3 + 2]! * (1 - d)) * weight
      total += weight
      this.sampledRadius += this.terrainR[j]! * weight
    }
    this.flow.multiplyScalar(1 / total)
    this.sampledRadius /= total
    this.flow.addScaledVector(p, -this.flow.dot(p))
    return cell
  }

  private point(t: number, out: THREE.Vector3): THREE.Vector3 {
    const u = Math.max(0, Math.min(POINTS - 1.00001, t * (POINTS - 1)))
    const i = Math.floor(u), f = u - i
    const r0 = Math.hypot(this.points[i * 3]!, this.points[i * 3 + 1]!, this.points[i * 3 + 2]!)
    const r1 = Math.hypot(this.points[(i + 1) * 3]!, this.points[(i + 1) * 3 + 1]!, this.points[(i + 1) * 3 + 2]!)
    return out.set(
      this.points[i * 3]! * (1 - f) + this.points[(i + 1) * 3]! * f,
      this.points[i * 3 + 1]! * (1 - f) + this.points[(i + 1) * 3 + 1]! * f,
      this.points[i * 3 + 2]! * (1 - f) + this.points[(i + 1) * 3 + 2]! * f
    ).normalize().multiplyScalar(r0 * (1 - f) + r1 * f)
  }

  private push(a: THREE.Vector3, b: THREE.Vector3, brightness: number, merge = false): void {
    if (a.distanceToSquared(b) < 1e-12) return
    if (merge) {
      // Coalesce parallel path segments occupying the same small region. The
      // representative carries the combined width, rather than drawing over itself.
      const cell = 0.008 + 0.012 * (1 - this.detail)
      const key = `${Math.round((a.x + b.x) / (2 * cell))},${Math.round((a.y + b.y) / (2 * cell))},${Math.round((a.z + b.z) / (2 * cell))}`
      const existing = this.merged.get(key)
      if (existing !== undefined) {
        const o = existing * 6
        const dx = this.pos[o + 3]! - this.pos[o]!, dy = this.pos[o + 4]! - this.pos[o + 1]!, dz = this.pos[o + 5]! - this.pos[o + 2]!
        const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z
        const align = (dx * bx + dy * by + dz * bz) / Math.max(1e-12, Math.hypot(dx, dy, dz) * Math.hypot(bx, by, bz))
        const endpointError = (a.x - this.pos[o]!) ** 2 + (a.y - this.pos[o + 1]!) ** 2 + (a.z - this.pos[o + 2]!) ** 2
          + (b.x - this.pos[o + 3]!) ** 2 + (b.y - this.pos[o + 4]!) ** 2 + (b.z - this.pos[o + 5]!) ** 2
        // Join with a connector, then use the already drawn downstream path.
        // Merely dropping the overlapping segment creates a hole in the branch.
        if (align > 0.95 && endpointError < cell * cell && this.segmentLine[existing] !== this.currentLine) {
          const end = this.lineEnds[this.segmentLine[existing]!]!
          for (let i = existing; i < end; i++) {
            this.mergeCounts[i] = this.mergeCounts[i]! + 1
            this.widths[i] = Math.min(4, Math.sqrt(this.mergeCounts[i]!))
          }
          b.fromArray(this.pos, o + 3)
          this.joined = true
        }
      }
      if (!this.joined) this.merged.set(key, this.count)
    }
    this.widths[this.count] = merge ? 1 : 1.25
    this.mergeCounts[this.count] = 1
    this.segmentLine[this.count] = this.currentLine
    const o = this.count++ * 6
    a.toArray(this.pos, o)
    b.toArray(this.pos, o + 3)
    for (let i = 0; i < 2; i++) {
      this.col[o + i * 3] = this.rgb.r * brightness
      this.col[o + i * 3 + 1] = this.rgb.g * brightness
      this.col[o + i * 3 + 2] = this.rgb.b * brightness
    }
  }

  update(dtFrames: number, evolve = true, cameraDistance = 3, camera?: THREE.Camera): void {
    this.obj.visible = this.visible
    if (!this.visible) {
      this.activeStreams = 0
      return
    }
    const zoom = Math.max(0, Math.min(1, (4 - cameraDistance) / 2.4))
    const desired = zoom * zoom * (3 - 2 * zoom)
    this.detail += (desired - this.detail) * -Math.expm1(-dtFrames / 18)
    this.mat.linewidth = 2.2 - 1.2 * this.detail
    if (camera) {
      camera.updateMatrixWorld()
      this.obj.parent!.updateWorldMatrix(true, false)
      this.viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(this.obj.parent!.matrixWorld)
      this.viewFrustum.setFromProjectionMatrix(this.viewMatrix)
      this.inverseWorld.copy(this.obj.parent!.matrixWorld).invert()
      this.localCamera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverseWorld)
    }
    const step = 0.015 - this.detail * 0.012
    // Bound the entire traced path, including arrowheads and terrain variation.
    // A seed outside the viewport can still have a visible downstream branch.
    this.bounds.radius = this.maxTerrainRadius * (HALF_STEPS * step + 0.025)
      + (this.maxTerrainRadius - this.minTerrainRadius) * 0.5
    const cameraRadius = this.localCamera.length()
    // Include both the elevated path's horizon and its full angular reach. Only
    // wholly hidden paths are rejected; branches crossing the limb remain.
    const visibleAngle = camera
      ? Math.acos(Math.min(1, this.opaqueRadius / cameraRadius))
      + Math.acos(Math.min(1, this.opaqueRadius / this.maxTerrainRadius)) + HALF_STEPS * step + 0.025
      : Math.PI
    const horizon = Math.cos(Math.min(Math.PI, visibleAngle)) * cameraRadius
    const { grid: g } = this.world.sphere
    const { air } = this.world
    // The displayed field trails the solver's, so streamlines do not shimmer on
    // per-tick noise. How far it trails is measured in TICKS, not frames: the field
    // it chases advances per tick, so a frame-based constant made the lag depend on
    // both frame rate and playback speed. At x16 the display trailed the weather by
    // days, and the pause transition below then had to cross all of it at once --
    // which is what visibly re-threw every streamline the moment you stopped.
    const ticks = this.world.tick - this.lastTick
    // A jump (first frame, rewind, seek) has no history worth easing from.
    const jumped = !this.ready || ticks < 0
    const alpha = jumped
      ? 1
      : evolve
        ? -Math.expm1(-ticks / FIELD_TAU_TICKS)
        // Paused: converge on the frozen weather instead of snapping to it. Settling
        // over a few frames keeps the field identical to the solver's once stopped --
        // so a later zoom still has real wind to trace, which a stale near-calm cache
        // did not -- without the discontinuity a straight snap produced.
        : -Math.expm1(-dtFrames / PAUSE_SETTLE_FRAMES)
    this.ready = true
    this.lastTick = this.world.tick
    let max = 1e-9
    for (let i = 0; i < g.count; i++) {
      const u = air.windU[i]!, v = air.windV[i]!
      let sq = 0
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k
        const target = g.east[j]! * u + g.north[j]! * v
        this.field[j] = this.field[j]! + (target - this.field[j]!) * alpha
        sq += this.field[j]! ** 2
      }
      max = Math.max(max, Math.sqrt(sq))
    }
    this.maxSpeed = max
    // Spatially aggregate neighbouring streams for the far view. Four diffusion
    // passes preserve the vector field while suppressing small local eddies.
    if (alpha > 0) {
      this.broadField.set(this.field)
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < g.count; i++) {
          const start = g.nbrStart[i]!, end = g.nbrStart[i + 1]!
          for (let axis = 0; axis < 3; axis++) {
            let sum = this.broadField[i * 3 + axis]!
            for (let k = start; k < end; k++) sum += this.broadField[g.nbrList[k]! * 3 + axis]!
            this.spatialScratch[i * 3 + axis] = sum / (end - start + 1)
          }
        }
        this.broadField.set(this.spatialScratch)
      }
    }
    this.count = 0
    this.activeStreams = 0
    this.merged.clear()
    for (let anchor = 0; anchor < ANCHORS; anchor++) {
      const fine = anchor >= COARSE_ANCHORS
      const split = anchor < MEDIUM_ANCHORS ? Math.min(1, this.detail * 2) : Math.max(0, this.detail * 2 - 1)
      const weight = fine ? split * split * (3 - 2 * split) : 1
      if (weight < 0.005) continue
      this.currentLine = anchor
      this.joined = false
      this.a.fromArray(this.anchors, this.parents[anchor]! * 3)
      this.b.fromArray(this.anchors, anchor * 3)
      this.a.lerp(this.b, fine ? split : 1).normalize()
      if (camera && this.a.dot(this.localCamera) < horizon) continue
      this.bounds.center.copy(this.a).multiplyScalar((this.minTerrainRadius + this.maxTerrainRadius) * 0.5)
      if (camera && !this.viewFrustum.intersectsSphere(this.bounds)) continue
      this.activeStreams++
      // Reuse the exact same moving seed for both halves of the streamline.
      const seedX = this.a.x, seedY = this.a.y, seedZ = this.a.z
      this.sample(this.a, this.cells[anchor]!)
      const speed = this.flow.length()
      const strength = Math.min(1, speed / max)
      // Fade continuously into calm regions; no visibility/ownership threshold.
      const brightness = Math.min(1, strength / 0.08) * weight
      const color = Math.max(0, Math.min(1, (strength - 0.05) / 0.95))
      for (let i = 0; i < RAMP.length - 1; i++) {
        const lo = RAMP[i]!, hi = RAMP[i + 1]!
        if (color <= hi[0]!) {
          const f = (color - lo[0]!) / (hi[0]! - lo[0]!)
          this.rgb.setRGB(lo[1]! + (hi[1]! - lo[1]!) * f,
            lo[2]! + (hi[2]! - lo[2]!) * f, lo[3]! + (hi[3]! - lo[3]!) * f)
          break
        }
      }
      this.midpoint.copy(this.a).multiplyScalar(this.sampledRadius).toArray(this.points, HALF_STEPS * 3)
      for (const sign of [-1, 1]) {
        this.a.set(seedX, seedY, seedZ)
        let cell = this.cells[anchor]!
        this.previousDir.set(0, 0, 0)
        let stopped = false
        for (let s = 1; s <= HALF_STEPS; s++) {
          if (!stopped) {
            cell = this.sample(this.a, cell)
            const localSpeed = this.flow.length()
            this.flow.normalize()
            const turn = s > 1 ? this.previousDir.dot(this.flow) : 1
            // A streamline ends at a sink/stagnation point; it must not bounce
            // back and forth across it and draw a zigzag staircase.
            stopped = localSpeed < Math.max(1e-7, speed * 0.12) || turn < 0.2
            if (!stopped) {
              this.previousDir.copy(this.flow)
              this.midpoint.copy(this.a).addScaledVector(this.flow, sign * step * 0.5).normalize()
              const midCell = this.sample(this.midpoint, cell)
              if (this.flow.length() < Math.max(1e-7, speed * 0.12)
                || this.flow.normalize().dot(this.previousDir) < 0.2) stopped = true
              else {
                this.a.addScaledVector(this.flow, sign * step).normalize()
                cell = midCell
              }
            }
          }
          this.midpoint.copy(this.a).multiplyScalar(this.sampledRadius).toArray(this.points, (HALF_STEPS + sign * s) * 3)
        }
      }
      // Long, faint continuous paths give the large circulation structure;
      // moving highlights indicate direction without breaking the paths into arrows.
      let pathEnd = 1
      for (let s = 0; s < POINTS - 1; s++) {
        this.a.fromArray(this.points, s * 3)
        this.b.fromArray(this.points, (s + 1) * 3)
        const endFade = Math.min(1, (s + 1) / 3, (POINTS - 1 - s) / 3)
        this.push(this.a, this.b, brightness * endFade * 0.65, true)
        if (this.joined) {
          this.b.toArray(this.points, (s + 1) * 3)
          pathEnd = (s + 1) / (POINTS - 1)
          break
        }
      }
      // This is a flow indicator clock; pausing freezes the field, not the arrows.
      this.phases[anchor] = (this.phases[anchor]! + dtFrames * speed * 0.15) % 1
      for (let arrow = 0; arrow < 2; arrow++) {
        const progress = (this.phases[anchor]! + arrow * 0.5) % 1
        const t = progress * pathEnd
        const fade = Math.sin(Math.PI * progress) ** 2 * brightness
        this.point(t, this.tip)
        this.point(t - 0.02, this.a)
        this.dir.copy(this.tip).sub(this.a).normalize()
        this.side.crossVectors(this.tip, this.dir).normalize()
        const head = (0.016 - 0.008 * this.detail) * this.tip.length()
        this.b.copy(this.tip).addScaledVector(this.dir, -head).addScaledVector(this.side, head * 0.5)
        this.c.copy(this.tip).addScaledVector(this.dir, -head).addScaledVector(this.side, -head * 0.5)
        const headRadius = Math.max(this.tip.length(), this.a.length())
        this.b.normalize().multiplyScalar(headRadius)
        this.c.normalize().multiplyScalar(headRadius)
        this.push(this.tip, this.b, fade)
        this.push(this.tip, this.c, fade)
      }
      this.lineEnds[anchor] = this.count
    }
    this.geo.instanceCount = this.count
    this.widthAttr.clearUpdateRanges()
    this.widthAttr.addUpdateRange(0, this.count)
    this.widthAttr.needsUpdate = true
    for (const name of ['instanceStart', 'instanceColorStart']) {
      const buffer = (this.geo.getAttribute(name) as THREE.InterleavedBufferAttribute).data
      buffer.clearUpdateRanges()
      buffer.addUpdateRange(0, this.count * 6)
      buffer.needsUpdate = true
    }
  }

  dispose(): void {
    this.obj.removeFromParent()
    this.geo.dispose()
    this.mat.dispose()
  }
}
