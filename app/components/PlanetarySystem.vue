<script setup lang="ts">
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  ATMO_FRAG,
  ATMO_VERT,
  GLOW_FRAG,
  PLANET_FRAG,
  PLANET_VERT,
  STAR_FRAG,
  STAR_VERT
} from '~/utils/shaders'

/**
 * Planetary system (all bodies + atmosphere computed on the GPU):
 *  - central rocky planet: tidally deformed (ellipsoidal) toward the inner
 *    moon, ridged rock displacement, fast chemical winds and thunderstorm
 *    clusters in the atmosphere shader;
 *  - massive inner moon, tidally locked with the planet, both orbiting their
 *    common barycenter;
 *  - smaller outer moon on an orthogonal orbital plane;
 *  - visible red dwarf star near the habitable zone.
 * Both moons cast analytic eclipse shadows onto the central planet.
 */

const container = ref<HTMLElement>()

const params = {
  // Simulation speed multiplier (sim seconds per real second).
  timeScale: 1.0,
  star: {
    radius: 5,
    // Placed so the red dwarf is visible in the default frame, behind and
    // to the right of the planet (dramatic crescent + eclipse geometry).
    position: new THREE.Vector3(18, -13, -81)
  },
  planet: {
    radius: 1,
    mass: 8,
    tidalBulge: 0.14,
    rockAmp: 0.12
  },
  innerMoon: {
    radius: 0.42,
    mass: 1,
    orbit: 3.2,
    period: 30
  },
  outerMoon: {
    radius: 0.16,
    mass: 0.15,
    orbit: 8.5,
    period: 110
  }
}

onMounted(() => {
  const el = container.value
  if (!el) return

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  el.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x02030a)

  const camera = new THREE.PerspectiveCamera(
    55,
    el.clientWidth / el.clientHeight,
    0.01,
    2000
  )
  camera.position.set(2.2, 2.6, 6.5)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 1.6
  controls.maxDistance = 60

  // --- Shared uniforms ------------------------------------------------------
  const uTime = { value: 0 }
  const uCamPos = { value: new THREE.Vector3() }
  const uPlanetPos = { value: new THREE.Vector3() }
  const uStarPos = { value: params.star.position.clone() }
  const uStarRadius = { value: params.star.radius }
  const uMoonPos = { value: [new THREE.Vector3(), new THREE.Vector3()] }
  const uMoonRadius = { value: [params.innerMoon.radius, params.outerMoon.radius] }

  // --- Central rocky planet ---------------------------------------------------
  const planetGeo = new THREE.SphereGeometry(1, 256, 256)
  const planetMat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uTime,
      uBulge: { value: params.planet.tidalBulge },
      uRockAmp: { value: params.planet.rockAmp },
      uPlanetPos,
      uCamPos,
      uStarPos,
      uStarRadius,
      uMoonPos,
      uMoonRadius
    }
  })
  const planet = new THREE.Mesh(planetGeo, planetMat)
  planet.scale.setScalar(params.planet.radius)
  scene.add(planet)

  // --- Atmosphere shell (winds, chemical clouds, storm clusters) --------------
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uTime,
      uPlanetPos,
      uCamPos,
      uStarPos,
      uStarRadius,
      uMoonPos,
      uMoonRadius
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  })
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.07, 128, 128), atmoMat)
  planet.add(atmosphere)

  // --- Moons (schematic spheres; they cast analytic shadows on the planet) ----
  const innerMoon = new THREE.Mesh(
    new THREE.SphereGeometry(params.innerMoon.radius, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0x9a9186,
      roughness: 0.95,
      metalness: 0,
      emissive: 0x120d0a
    })
  )
  scene.add(innerMoon)

  const outerMoon = new THREE.Mesh(
    new THREE.SphereGeometry(params.outerMoon.radius, 48, 48),
    new THREE.MeshStandardMaterial({
      color: 0x7d8794,
      roughness: 1,
      metalness: 0,
      emissive: 0x0a0d12
    })
  )
  scene.add(outerMoon)

  // --- Red dwarf star -----------------------------------------------------------
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { uTime, uCamPos }
  })
  const star = new THREE.Mesh(new THREE.SphereGeometry(params.star.radius, 64, 64), starMat)
  star.position.copy(params.star.position)
  scene.add(star)

  const glowMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uCamPos },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  })
  const starGlow = new THREE.Mesh(new THREE.SphereGeometry(params.star.radius * 1.6, 48, 48), glowMat)
  starGlow.position.copy(params.star.position)
  scene.add(starGlow)

  // Light of the star for the schematic moons (no distance falloff).
  const starLight = new THREE.PointLight(0xffa066, 2.6, 0, 0)
  starLight.position.copy(params.star.position)
  scene.add(starLight)
  // Keep the night sides of the schematic moons discernible.
  scene.add(new THREE.AmbientLight(0x3a4a70, 0.9))

  // --- Schematic orbit lines ------------------------------------------------------
  function orbitCircle(radius: number, color: number, rotation?: THREE.Euler) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 })
    )
    if (rotation) line.rotation.copy(rotation)
    scene.add(line)
    return line
  }

  const totalMass = params.planet.mass + params.innerMoon.mass
  const rPlanet = params.innerMoon.orbit * params.innerMoon.mass / totalMass
  const rMoon = params.innerMoon.orbit * params.planet.mass / totalMass

  orbitCircle(rPlanet, 0x6688aa)
  orbitCircle(rMoon, 0x6688aa)
  // Orthogonal plane for the outer moon.
  orbitCircle(params.outerMoon.orbit, 0x88aacc, new THREE.Euler(Math.PI / 2, 0, 0))

  // --- Background starfield ---------------------------------------------------------
  {
    const n = 1500
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(300 + Math.random() * 300)
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xbfd0ff,
      size: 1.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.75
    })
    scene.add(new THREE.Points(geo, mat))
  }

  // --- Simulation loop ----------------------------------------------------------------
  const clock = new THREE.Clock()
  let simTime = 0
  let rafId = 0

  function frame() {
    rafId = requestAnimationFrame(frame)

    const dt = Math.min(clock.getDelta(), 0.05) * params.timeScale
    simTime += dt
    uTime.value = simTime
    uCamPos.value.copy(camera.position)

    // Inner pair orbits the common barycenter; both are tidally locked.
    const theta = (simTime / params.innerMoon.period) * Math.PI * 2
    planet.position.set(-Math.cos(theta) * rPlanet, 0, -Math.sin(theta) * rPlanet)
    // Tidal lock: the same hemisphere (local +X, where the bulge points)
    // always faces the inner moon.
    planet.rotation.y = -theta
    // Small physical libration for realism.
    const libration = 0.02 * Math.sin(theta * 2)
    innerMoon.position.set(Math.cos(theta) * rMoon, 0, Math.sin(theta) * rMoon)
    innerMoon.rotation.y = -theta + Math.PI + libration

    // Outer moon: orthogonal orbital plane (XY).
    const psi = (simTime / params.outerMoon.period) * Math.PI * 2 + 1.3
    outerMoon.position.set(Math.cos(psi) * params.outerMoon.orbit, Math.sin(psi) * params.outerMoon.orbit, 0)
    outerMoon.rotation.y = -psi

    uPlanetPos.value.copy(planet.position)
    uMoonPos.value[0].copy(innerMoon.position)
    uMoonPos.value[1].copy(outerMoon.position)

    // Orbital camera centered on the central planet.
    controls.target.copy(planet.position)
    controls.update()

    renderer.render(scene, camera)
  }
  frame()

  // --- Resize -------------------------------------------------------------------------
  const resize = () => {
    const w = el.clientWidth
    const h = el.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)

  onBeforeUnmount(() => {
    cancelAnimationFrame(rafId)
    window.removeEventListener('resize', resize)
    controls.dispose()
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
        obj.geometry.dispose()
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach(m => m.dispose())
      }
    })
    renderer.dispose()
    el.removeChild(renderer.domElement)
  })
})
</script>

<template>
  <div ref="container" class="fixed inset-0 h-full w-full" />
</template>
