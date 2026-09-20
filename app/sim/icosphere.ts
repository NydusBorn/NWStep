/**
 * Geodesic sphere (icosphere) used as BOTH the simulation grid and the render mesh.
 *
 * Why an icosphere and not lat/lon: a lat/lon grid has a singularity at the poles,
 * and the two things this simulation most needs to look right -- mountain belts and
 * zonal jet streams -- are exactly the things that would smear there.
 *
 * The sim runs on a coarse level (default 5 = 10,242 cells) and the mesh is drawn at
 * a finer level (default 6 = 40,962 vertices). Because subdivision only ever *appends*
 * vertices, the coarse set is a strict prefix of the fine set, and every fine vertex
 * can be mapped back to a coarse cell in O(1) via its two parents.
 */

export interface Grid {
  level: number
  count: number
  /** unit position, count*3 */
  pos: Float32Array
  /** local east tangent, count*3 */
  east: Float32Array
  /** local north tangent, count*3 */
  north: Float32Array
  lat: Float32Array
  lon: Float32Array
  /** CSR adjacency: neighbours of cell i are nbrList[nbrStart[i] .. nbrStart[i+1]) */
  nbrStart: Int32Array
  nbrList: Int32Array
  /** per adjacency entry: tangential distance, and direction in (east, north) */
  nbrLen: Float32Array
  nbrU: Float32Array
  nbrV: Float32Array
}

export interface RenderMesh {
  count: number
  pos: Float32Array
  indices: Uint32Array
  /** render vertex -> sim cell (nearest; use `interpolate` for smooth fields) */
  owner: Int32Array
  /** the two vertices this one was created as the midpoint of, -1 for originals */
  parentA: Int32Array
  parentB: Int32Array
  /** number of leading vertices that ARE the sim cells */
  simCount: number
}

/**
 * Spread a sim-resolution field smoothly across the render mesh.
 *
 * Taking each render vertex's nearest sim cell gives flat facets -- you end up looking
 * at the level-5 Voronoi cells, which on a cloud deck reads as a sheet of hexagons.
 * Every finer vertex is the midpoint of two coarser ones, and parents always have a
 * lower index, so one forward pass averaging the parents gives proper piecewise-linear
 * interpolation for free.
 */
export function interpolateToMesh(
  mesh: RenderMesh,
  src: Float32Array,
  out: Float32Array
): void {
  const { simCount, parentA, parentB, count } = mesh
  for (let v = 0; v < count; v++) {
    out[v] = v < simCount
      ? src[v]!
      : (out[parentA[v]!]! + out[parentB[v]!]!) * 0.5
  }
}

export interface Sphere {
  grid: Grid
  mesh: RenderMesh
}

const PHI = (1 + Math.sqrt(5)) / 2

const BASE_VERTS = [
  -1, PHI, 0, 1, PHI, 0, -1, -PHI, 0, 1, -PHI, 0,
  0, -1, PHI, 0, 1, PHI, 0, -1, -PHI, 0, 1, -PHI,
  PHI, 0, -1, PHI, 0, 1, -PHI, 0, -1, -PHI, 0, 1
]

const BASE_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
]

export function buildSphere(simLevel: number, renderLevel: number): Sphere {
  const verts: number[] = []
  for (let i = 0; i < BASE_VERTS.length; i += 3) {
    const x = BASE_VERTS[i]!, y = BASE_VERTS[i + 1]!, z = BASE_VERTS[i + 2]!
    const l = Math.hypot(x, y, z)
    verts.push(x / l, y / l, z / l)
  }
  // parent vertices of each midpoint; -1 for the 12 originals
  const parentA: number[] = new Array(12).fill(-1)
  const parentB: number[] = new Array(12).fill(-1)

  let faces = BASE_FACES.slice()
  let simFaces: number[] = []
  let simCount = 0

  const cache = new Map<number, number>()
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * 1e6 + b : b * 1e6 + a
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const ax = verts[a * 3]!, ay = verts[a * 3 + 1]!, az = verts[a * 3 + 2]!
    const bx = verts[b * 3]!, by = verts[b * 3 + 1]!, bz = verts[b * 3 + 2]!
    let mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2
    const l = Math.hypot(mx, my, mz)
    mx /= l; my /= l; mz /= l
    const idx = verts.length / 3
    verts.push(mx, my, mz)
    parentA.push(a)
    parentB.push(b)
    cache.set(key, idx)
    return idx
  }

  for (let level = 0; level < renderLevel; level++) {
    if (level === simLevel) {
      simFaces = faces.slice()
      simCount = verts.length / 3
    }
    const next: number[] = []
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f]!, b = faces[f + 1]!, c = faces[f + 2]!
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a)
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
    }
    faces = next
  }
  if (simLevel === renderLevel) {
    simFaces = faces.slice()
    simCount = verts.length / 3
  }

  const renderCount = verts.length / 3
  const pos = new Float32Array(verts)

  // ---- owner map: every render vertex resolves to a sim cell -------------------
  const owner = new Int32Array(renderCount)
  for (let v = 0; v < renderCount; v++) {
    if (v < simCount) { owner[v] = v; continue }
    // parents always have a lower index, so their owner is already resolved
    const a = parentA[v]!, b = parentB[v]!
    const oa = owner[a]!, ob = owner[b]!
    const d = (o: number) =>
      (pos[v * 3]! - pos[o * 3]!) ** 2
      + (pos[v * 3 + 1]! - pos[o * 3 + 1]!) ** 2
      + (pos[v * 3 + 2]! - pos[o * 3 + 2]!) ** 2
    owner[v] = d(oa) <= d(ob) ? oa : ob
  }

  // ---- sim adjacency from the coarse face list --------------------------------
  const adj: number[][] = Array.from({ length: simCount }, () => [])
  const link = (a: number, b: number) => {
    if (!adj[a]!.includes(b)) adj[a]!.push(b)
  }
  for (let f = 0; f < simFaces.length; f += 3) {
    const a = simFaces[f]!, b = simFaces[f + 1]!, c = simFaces[f + 2]!
    link(a, b); link(b, a)
    link(b, c); link(c, b)
    link(c, a); link(a, c)
  }

  const nbrStart = new Int32Array(simCount + 1)
  let total = 0
  for (let i = 0; i < simCount; i++) { nbrStart[i] = total; total += adj[i]!.length }
  nbrStart[simCount] = total
  const nbrList = new Int32Array(total)
  for (let i = 0; i < simCount; i++) {
    const a = adj[i]!
    for (let k = 0; k < a.length; k++) nbrList[nbrStart[i]! + k] = a[k]!
  }

  // ---- local tangent frames ---------------------------------------------------
  const east = new Float32Array(simCount * 3)
  const north = new Float32Array(simCount * 3)
  const lat = new Float32Array(simCount)
  const lon = new Float32Array(simCount)
  for (let i = 0; i < simCount; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!
    // east = normalize(spinAxis x p), spin axis is +Y
    let ex = z, ey = 0, ez = -x
    let el = Math.hypot(ex, ey, ez)
    if (el < 1e-8) { ex = 1; ey = 0; ez = 0; el = 1 } // at the poles, pick any tangent
    ex /= el; ey /= el; ez /= el
    east[i * 3] = ex; east[i * 3 + 1] = ey; east[i * 3 + 2] = ez
    // north = p x east
    north[i * 3] = y * ez - z * ey
    north[i * 3 + 1] = z * ex - x * ez
    north[i * 3 + 2] = x * ey - y * ex
    lat[i] = Math.asin(Math.max(-1, Math.min(1, y)))
    lon[i] = Math.atan2(z, x)
  }

  // ---- per-edge tangential geometry, precomputed once --------------------------
  const nbrLen = new Float32Array(total)
  const nbrU = new Float32Array(total)
  const nbrV = new Float32Array(total)
  for (let i = 0; i < simCount; i++) {
    const px = pos[i * 3]!, py = pos[i * 3 + 1]!, pz = pos[i * 3 + 2]!
    const ex = east[i * 3]!, ey = east[i * 3 + 1]!, ez = east[i * 3 + 2]!
    const nx = north[i * 3]!, ny = north[i * 3 + 1]!, nz = north[i * 3 + 2]!
    for (let k = nbrStart[i]!; k < nbrStart[i + 1]!; k++) {
      const j = nbrList[k]!
      let dx = pos[j * 3]! - px, dy = pos[j * 3 + 1]! - py, dz = pos[j * 3 + 2]! - pz
      const radial = dx * px + dy * py + dz * pz
      dx -= radial * px; dy -= radial * py; dz -= radial * pz
      const len = Math.hypot(dx, dy, dz) || 1e-8
      nbrLen[k] = len
      nbrU[k] = (dx * ex + dy * ey + dz * ez) / len
      nbrV[k] = (dx * nx + dy * ny + dz * nz) / len
    }
  }

  return {
    grid: {
      level: simLevel, count: simCount,
      pos: pos.slice(0, simCount * 3),
      east, north, lat, lon,
      nbrStart, nbrList, nbrLen, nbrU, nbrV
    },
    mesh: {
      count: renderCount,
      pos,
      indices: new Uint32Array(faces),
      owner,
      parentA: new Int32Array(parentA),
      parentB: new Int32Array(parentB),
      simCount
    }
  }
}

/** Vertex count for a given subdivision level. */
export function vertexCount(level: number): number {
  return 10 * 4 ** level + 2
}
