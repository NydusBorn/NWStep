import * as THREE from 'three'
import type { World } from '../sim/world'
import { colonyRadius, population } from '../sim/life'

const LIMIT = 1024
const SEGMENTS = 48
const SPARKS = 32

/** Diagnostic yellow boundaries and independently visible electrical sparkles. */
export class ColonyLayer {
  private outlines: THREE.LineSegments
  private sparks: THREE.Points
  private positions = new Float32Array(LIMIT * SEGMENTS * 6)
  private colors = new Float32Array(LIMIT * SEGMENTS * 6)
  private sparkPositions = new Float32Array(LIMIT * SPARKS * 3)
  private sparkColors = new Float32Array(LIMIT * SPARKS * 3)
  private sizes = new Float32Array(LIMIT * SPARKS)
  private normal = new THREE.Vector3()
  private east = new THREE.Vector3()
  private north = new THREE.Vector3()
  private point = new THREE.Vector3()

  constructor(parent: THREE.Group, private world: World) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setDrawRange(0, 0)
    this.outlines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false
    }))
    const sparkGeometry = new THREE.BufferGeometry()
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3).setUsage(THREE.DynamicDrawUsage))
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3).setUsage(THREE.DynamicDrawUsage))
    sparkGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
    sparkGeometry.setDrawRange(0, 0)
    this.sparks = new THREE.Points(sparkGeometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 color;
        attribute float size;
        varying vec3 tint;
        void main() {
          tint = color;
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_PointSize = clamp(size / max(0.4, -p.z), 1.0, 14.0);
        }`,
      fragmentShader: `
        varying vec3 tint;
        void main() {
          vec2 p = abs(gl_PointCoord - 0.5) * 2.0;
          float core = exp(-18.0 * dot(p, p));
          float cross = exp(-75.0 * min(p.x*p.x, p.y*p.y)) * pow(max(0.0, 1.0-max(p.x,p.y)), 3.0);
          float a = max(core, cross * 0.75);
          if (a < 0.025) discard;
          gl_FragColor = vec4(tint, a);
        }`
    }))
    this.outlines.frustumCulled = false
    this.sparks.frustumCulled = false
    // Clouds render at order 5; do not let their translucent shell paint over
    // diagnostic boundaries or the electrical emissions above it.
    this.sparks.renderOrder = 6
    this.outlines.renderOrder = 7
    parent.add(this.outlines, this.sparks)
  }

  update(radius: number, visible: boolean, selected: number | null, showCreatures = true): void {
    this.outlines.visible = visible
    this.sparks.visible = showCreatures
    let line = 0, spark = 0
    for (const c of this.world.life.colonies.slice(0, LIMIT)) {
      this.normal.set(...c.position)
      this.east.set(0, 1, 0).cross(this.normal)
      if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0).cross(this.normal)
      this.east.normalize()
      this.north.crossVectors(this.normal, this.east).normalize()
      const extent = colonyRadius(c)
      for (let segment = 0; segment < SEGMENTS; segment++) {
        for (let end = 0; end < 2; end++) {
          const angle = (segment + end) / SEGMENTS * Math.PI * 2
          this.place(radius, extent * Math.cos(angle), extent * Math.sin(angle))
          this.point.toArray(this.positions, line * 3)
          this.colors.set(c.id === selected ? [1, 0.55, 0] : [1, 1, 0], line * 3)
          line++
        }
      }
      const count = Math.min(SPARKS, population(c))
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963 + c.id * 1.618
        const spread = Math.sqrt((i + 0.5) / count) * extent * 0.85
        const pulse = Math.pow(Math.max(0, Math.sin(c.phase * 2 + i * 2.17 + c.id)), 8)
        if (pulse < 0.08) continue
        this.place(radius + 0.001, spread * Math.cos(angle), spread * Math.sin(angle))
        this.point.toArray(this.sparkPositions, spark * 3)
        const positive = (i + 0.5) / count < c.positive / Math.max(1, population(c))
        const color = positive ? [1, 0.65, 0.08] : [0.15, 0.6, 1]
        this.sparkColors.set(color.map(v => v * pulse), spark * 3)
        this.sizes[spark] = 4 + pulse * 10
        spark++
      }
    }
    this.outlines.geometry.setDrawRange(0, line)
    this.sparks.geometry.setDrawRange(0, spark)
    for (const object of [this.outlines, this.sparks]) {
      for (const attribute of Object.values(object.geometry.attributes)) attribute.needsUpdate = true
    }
  }

  private place(radius: number, u: number, v: number): void {
    this.point.copy(this.normal).addScaledVector(this.east, u).addScaledVector(this.north, v).normalize().multiplyScalar(radius)
  }

  dispose(): void {
    for (const object of [this.outlines, this.sparks]) {
      object.removeFromParent()
      object.geometry.dispose()
      ;(object.material as THREE.Material).dispose()
    }
  }
}
