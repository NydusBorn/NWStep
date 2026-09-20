import * as THREE from 'three'
import type { World } from '../sim/world'

/** Bolts are anchored only to simulated atmospheric breakdown events. */
export class LightningLayer {
  private bolts: THREE.LineSegments
  private positions = new Float32Array(96 * 8 * 6)
  private colors = new Float32Array(96 * 8 * 6)
  private center = new THREE.Vector3()
  private east = new THREE.Vector3()
  private north = new THREE.Vector3()

  constructor(parent: THREE.Group, private world: World) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setDrawRange(0, 0)
    this.bolts = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }))
    this.bolts.frustumCulled = false
    this.bolts.renderOrder = 6
    parent.add(this.bolts)
  }

  update(radius: number): void {
    const g = this.world.sphere.grid
    let vertex = 0
    for (const event of this.world.clouds.flashEvents.slice(-96)) {
      const age = this.world.tick - event.tick
      if (age < 0 || age > 6) continue
      const i = event.cell
      this.center.fromArray(g.pos, i * 3).multiplyScalar(radius)
      this.east.fromArray(g.east, i * 3)
      this.north.fromArray(g.north, i * 3)
      const intensity = Math.max(0, 1 - age / 7)
      for (let segment = 0; segment < 8; segment++) {
        for (let end = 0; end < 2; end++) {
          const k = segment + end
          const along = (k / 8 - 0.5) * 0.07
          const jag = k === 0 || k === 8 ? 0 : Math.sin(i * 13.7 + k * 9.1 + event.tick) * 0.009
          for (let axis = 0; axis < 3; axis++) {
            this.positions[vertex * 3 + axis] = this.center.getComponent(axis)
              + this.north.getComponent(axis) * along + this.east.getComponent(axis) * jag
          }
          this.colors.set([intensity * 0.65, intensity * 0.82, intensity], vertex * 3)
          vertex++
        }
      }
    }
    this.bolts.geometry.setDrawRange(0, vertex)
    for (const attribute of Object.values(this.bolts.geometry.attributes)) attribute.needsUpdate = true
  }

  dispose(): void {
    this.bolts.removeFromParent()
    this.bolts.geometry.dispose()
    ;(this.bolts.material as THREE.Material).dispose()
  }
}
