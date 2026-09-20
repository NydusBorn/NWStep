/** Seeded RNG. Every random value in the simulation comes from here, so a seed
 *  reproduces a universe exactly. `Math.random()` must never be used in sim/. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
])

const F3 = 1 / 3
const G3 = 1 / 6

/** Classic 3D simplex noise, seeded. Returns roughly [-1, 1]. */
export class Simplex {
  private perm = new Uint8Array(512)
  private permMod12 = new Uint8Array(512)

  constructor(seed: number) {
    const rnd = mulberry32(seed)
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = p[i]!; p[i] = p[j]!; p[j] = t
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]!
      this.permMod12[i] = this.perm[i]! % 12
    }
  }

  noise(xin: number, yin: number, zin: number): number {
    const perm = this.perm, permMod12 = this.permMod12
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t)

    let i1, j1, k1, i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3

    const ii = i & 255, jj = j & 255, kk = k & 255
    let n = 0

    const corner = (x: number, y: number, z: number, gi: number) => {
      let tt = 0.6 - x * x - y * y - z * z
      if (tt < 0) return 0
      tt *= tt
      const g = gi * 3
      return tt * tt * (GRAD3[g]! * x + GRAD3[g + 1]! * y + GRAD3[g + 2]! * z)
    }

    n += corner(x0, y0, z0, permMod12[ii + perm[jj + perm[kk]!]!]!)
    n += corner(x1, y1, z1, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]!)
    n += corner(x2, y2, z2, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]!)
    n += corner(x3, y3, z3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]!)

    return 32 * n
  }

  /** Fractal Brownian motion. Smooth, continent-scale shapes. */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0, amp = 1, freq = 1, norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, z * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }

  /** Ridged multifractal. This is what makes mountain *ranges* instead of blobs. */
  ridged(x: number, y: number, z: number, octaves: number, lacunarity = 2.1, gain = 0.5): number {
    let sum = 0, amp = 1, freq = 1, norm = 0
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq, z * freq))
      sum += amp * n * n
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}
